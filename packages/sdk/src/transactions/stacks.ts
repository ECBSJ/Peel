// ---------------------------------------------------------------------------
// Stacks transaction builders, preparers, encoder, and broadcaster
//
// Supports:
//   - STX native token transfers
//   - sBTC SIP-010 token transfers
//
// Lifecycle:
//   1. build    — construct minimal tx intent (no nonce/fee yet)
//   2. prepare  — fetch nonce from Hiro API, build unsigned tx, compute
//                 preSignSigHash for external signing
//   3. encode   — inject OWS signature into the unsigned tx wire object
//   4. broadcast — submit to Stacks node and return the txid
//
// Signing flow (Stacks uses secp256k1 — same curve as Bitcoin):
//   a. Pass `prepared.preSignSigHash` (32-byte hex, no 0x) to OWS
//   b. OWS command: ows sign tx --chain bitcoin --tx <preSignSigHash>
//      The payload is already hashed — the signer must NOT re-hash it.
//   c. OWS returns signature as hex r || s || v (v at end, raw recovery ID 0/1)
//   d. encodeStacksSignedTx converts OWS format to Stacks format (v || r || s)
//      and injects it into the transaction
//
// Stacks compressed-key convention:
//   Stacks derives addresses from the COMPRESSED secp256k1 public key (33 bytes,
//   66 hex chars, prefix 02 or 03). In the Stacks ecosystem this is signalled by
//   appending an `01` byte to the raw 32-byte private key (making it 33 bytes)
//   before address derivation — the `01` means "use compressed pubkey format".
//
//   When deriving the Stacks address from an OWS private key:
//     ❌ Do NOT use the uncompressed public key (65 bytes, prefix 04) — it yields
//        a different address and will result in NotEnoughFunds on broadcast.
//     ✅ Use the compressed public key. OWS exposes this via:
//          ows wallet info --wallet <name> --json  →  publicKey field (33 bytes)
//        Alternatively, derive it from the raw private key by appending 01 and
//        using getPublicKey(privKey, compressed=true) from noble/secp256k1.
// ---------------------------------------------------------------------------

import {
  makeUnsignedSTXTokenTransfer,
  makeUnsignedContractCall,
  sigHashPreSign,
  createMessageSignature,
  broadcastTransaction,
  uintCV,
  principalCV,
  noneCV,
  someCV,
  bufferCV,
  PostConditionMode,
  transactionToHex,
  type StacksTransactionWire,
  type SingleSigSpendingCondition,
} from "@stacks/transactions";
import { SBTC } from "../balances/contracts.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIRO_MAINNET = "https://api.hiro.so";
const HIRO_TESTNET = "https://api.testnet.hiro.so";

/** Default fee in microSTX. Covers typical STX and sBTC transfers. */
const DEFAULT_FEE_USTX = 2000n;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StacksTxRequest {
  /** "stx-transfer" sends native STX; "sbtc-transfer" calls sBTC SIP-010 */
  type: "stx-transfer" | "sbtc-transfer";
  /** Sender Stacks address (SP... mainnet, ST... testnet) */
  from: string;
  /** Recipient Stacks address */
  to: string;
  /**
   * Transfer amount.
   * - STX: microSTX (1 STX = 1_000_000 microSTX)
   * - sBTC: satoshis (8 decimals, same as BTC)
   */
  amount: bigint;
  /**
   * Sender's compressed secp256k1 public key, hex-encoded (66 chars / 33 bytes,
   * prefix `02` or `03`). Same key used in OWS/BRID derivation.
   *
   * **Stacks compressed-key convention:** Stacks addresses are derived from the
   * COMPRESSED public key. In the Stacks ecosystem, this is signalled by
   * appending an `01` byte to the raw 32-byte private key before address
   * derivation — `01` means "compressed pubkey format".
   *
   * Always use the compressed pubkey (33 bytes). Using the uncompressed key
   * (65 bytes, prefix `04`) will derive a DIFFERENT address and cause
   * `NotEnoughFunds` errors on broadcast, even if the wallet is funded.
   *
   * Source: `ows wallet info --wallet <name> --json` → `publicKey` field.
   */
  publicKey: string;
  testnet: boolean;
  /**
   * Optional memo to embed in the transaction.
   * - STX transfers: embedded in the native Stacks `memo` field (max 34 bytes).
   * - sBTC SIP-010 transfers: passed as the `(optional (buff 34))` memo param
   *   of the `transfer` function. Max 34 bytes.
   * The Peel router sets this automatically from the Peel memo when routing.
   */
  memo?: Uint8Array;
}

export interface StacksTxPrepared {
  type: "stx-transfer" | "sbtc-transfer";
  from: string;
  to: string;
  amount: bigint;
  testnet: boolean;
  nonce: bigint;
  fee: bigint;
  /**
   * 32-byte hex string (no 0x prefix) to pass to the OWS Bitcoin signer.
   * This is already hashed — the signer must NOT hash it again.
   *
   * OWS command:
   *   ows sign tx --chain bitcoin --tx <preSignSigHash>
   *
   * The returned signature (r || s || v, OWS format) is passed directly to
   * encodeStacksSignedTx — no manual conversion needed.
   */
  preSignSigHash: string;
  /** @internal Unsigned tx wire — preserved for encodeStacksSignedTx */
  _wire: StacksTransactionWire;
}

export interface OwsSignResult {
  /** Hex-encoded 65-byte signature: r(32) || s(32) || v(1). OWS format. */
  signature: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchNonce(address: string, testnet: boolean, hiroBaseUrl?: string): Promise<bigint> {
  const base = hiroBaseUrl ?? (testnet ? HIRO_TESTNET : HIRO_MAINNET);

  // Prefer the extended nonces endpoint: returns possible_next_nonce which
  // accounts for pending mempool transactions, preventing nonce conflicts when
  // multiple transactions are prepared back-to-back before the first confirms.
  try {
    const res = await fetch(`${base}/extended/v1/address/${address}/nonces`);
    if (res.ok) {
      const data = (await res.json()) as { possible_next_nonce: number };
      if (typeof data.possible_next_nonce === "number") {
        return BigInt(data.possible_next_nonce);
      }
    }
  } catch {}

  // Fallback: basic account endpoint (confirmed nonce only)
  const res = await fetch(`${base}/v2/accounts/${address}?proof=0`);
  if (!res.ok) {
    throw new Error(`failed to fetch nonce for ${address}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { nonce: number };
  return BigInt(data.nonce);
}

function splitSbtcContract(testnet: boolean): { contractAddress: string; contractName: string } {
  const full = testnet ? SBTC.testnet : SBTC.mainnet;
  const dot = full.indexOf(".");
  return {
    contractAddress: full.slice(0, dot),
    contractName: full.slice(dot + 1),
  };
}

// ---------------------------------------------------------------------------
// buildStxTransfer
// ---------------------------------------------------------------------------

/**
 * Build an unsigned STX transfer intent.
 *
 * @param from       Sender Stacks address
 * @param to         Recipient Stacks address
 * @param amount     Amount in microSTX (1 STX = 1_000_000 microSTX)
 * @param publicKey  Sender's 33-byte compressed pubkey, hex-encoded
 * @param testnet    true → testnet (ST... addresses), false → mainnet (SP...)
 */
export function buildStxTransfer(
  from: string,
  to: string,
  amount: bigint,
  publicKey: string,
  testnet: boolean,
): StacksTxRequest {
  return { type: "stx-transfer", from, to, amount, publicKey, testnet };
}

// ---------------------------------------------------------------------------
// buildSbtcTransfer
// ---------------------------------------------------------------------------

/**
 * Build an unsigned sBTC SIP-010 transfer intent.
 *
 * @param from       Sender Stacks address
 * @param to         Recipient Stacks address
 * @param amount     Amount in satoshis (8 decimals)
 * @param publicKey  Sender's 33-byte compressed pubkey, hex-encoded
 * @param testnet    true → testnet, false → mainnet
 */
export function buildSbtcTransfer(
  from: string,
  to: string,
  amount: bigint,
  publicKey: string,
  testnet: boolean,
): StacksTxRequest {
  return { type: "sbtc-transfer", from, to, amount, publicKey, testnet };
}

// ---------------------------------------------------------------------------
// prepareStacksTx
// ---------------------------------------------------------------------------

/**
 * Fetch the sender's current nonce, build the unsigned transaction, and
 * compute the `preSignSigHash` for external signing.
 *
 * Must be called immediately before signing — nonce goes stale.
 *
 * @param tx           Transaction intent from buildStxTransfer / buildSbtcTransfer
 * @param fee          Fee in microSTX (default: 2000 microSTX)
 * @param hiroBaseUrl  Override Hiro API base URL (for custom nodes)
 */
export async function prepareStacksTx(
  tx: StacksTxRequest,
  fee: bigint = DEFAULT_FEE_USTX,
  hiroBaseUrl?: string,
): Promise<StacksTxPrepared> {
  const nonce = await fetchNonce(tx.from, tx.testnet, hiroBaseUrl);
  const network = tx.testnet ? "testnet" : "mainnet";

  let wire: StacksTransactionWire;

  if (tx.type === "stx-transfer") {
    wire = await makeUnsignedSTXTokenTransfer({
      recipient: tx.to,
      amount: tx.amount,
      publicKey: tx.publicKey,
      network,
      nonce,
      fee,
    });
  } else {
    // sBTC SIP-010 transfer:
    // contract transfer(amount uint, sender principal, recipient principal, memo optional)
    const { contractAddress, contractName } = splitSbtcContract(tx.testnet);

    wire = await makeUnsignedContractCall({
      contractAddress,
      contractName,
      functionName: "transfer",
      functionArgs: [
        uintCV(tx.amount),
        principalCV(tx.from),
        principalCV(tx.to),
        tx.memo ? someCV(bufferCV(tx.memo.slice(0, 34))) : noneCV(),
      ],
      publicKey: tx.publicKey,
      network,
      nonce,
      fee,
      postConditionMode: PostConditionMode.Allow,
    });
  }

  const sigHash = wire.signBegin();
  const preSignSigHash = sigHashPreSign(
    sigHash,
    wire.auth.authType,
    wire.auth.spendingCondition.fee,
    wire.auth.spendingCondition.nonce,
  );

  return {
    type: tx.type,
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    testnet: tx.testnet,
    nonce,
    fee,
    preSignSigHash,
    _wire: wire,
  };
}

// ---------------------------------------------------------------------------
// encodeStacksSignedTx
// ---------------------------------------------------------------------------

/**
 * Inject an OWS signature into the prepared transaction and return the
 * broadcast-ready hex string.
 *
 * OWS returns signatures as r || s || v (v at end, raw recovery ID 0 or 1).
 * Stacks expects v || r || s (v at front). This function converts automatically.
 *
 * @param prepared  Prepared transaction from prepareStacksTx
 * @param sig       OWS signature: hex r(32) || s(32) || v(1)
 * @returns         Hex-encoded signed transaction ready for broadcastStacksTx
 */
export function encodeStacksSignedTx(prepared: StacksTxPrepared, sig: OwsSignResult): string {
  const sigBytes = sig.signature.replace(/^0x/, "");
  if (sigBytes.length !== 130) {
    throw new Error(
      `expected 65-byte signature (130 hex chars), got ${sigBytes.length / 2} bytes`,
    );
  }

  // OWS format: r(64 hex) || s(64 hex) || v(2 hex)
  // Stacks format: v(2 hex) || r(64 hex) || s(64 hex)
  const nextSig = sigBytes.slice(128, 130) + sigBytes.slice(0, 128);

  (prepared._wire.auth.spendingCondition as SingleSigSpendingCondition).signature =
    createMessageSignature(nextSig);

  return transactionToHex(prepared._wire);
}

// ---------------------------------------------------------------------------
// broadcastStacksTx
// ---------------------------------------------------------------------------

/**
 * Broadcast a signed Stacks transaction and return the txid.
 *
 * @param signedTxHex  Hex-encoded signed transaction from encodeStacksSignedTx
 * @param testnet      true → testnet, false → mainnet
 * @returns            Transaction ID (txid) as a hex string
 */
export async function broadcastStacksTx(
  signedTxHex: string,
  testnet: boolean,
): Promise<string> {
  const network = testnet ? "testnet" : "mainnet";

  // Deserialize the hex back to a StacksTransactionWire for broadcastTransaction
  const { deserializeTransaction } = await import("@stacks/transactions");
  const tx = deserializeTransaction(signedTxHex);

  const result = await broadcastTransaction({ transaction: tx, network });

  if ("error" in result) {
    throw new Error(
      `broadcast failed: ${result.error}${result.reason ? ` — ${result.reason}` : ""}`,
    );
  }

  return result.txid;
}
