// ---------------------------------------------------------------------------
// Recipient recovery — derive a full BRID identity from an on-chain address
//
// Two recovery paths live here (pure crypto, no chain-specific quirks):
//
//   1. Stacks (SP/ST) → pubkey via ECDSA recovery from any signed transaction
//   2. Bitcoin (bc1q) → pubkey directly from P2WPKH spending witness data
//
// EVM (0x...) recovery requires RLP transaction re-encoding and lives in
// @peelbtc/sdk (which has viem). See sdk/src/identity/recover.ts.
//
// All paths return a 33-byte compressed secp256k1 public key, which is fed
// into buildIdentityFromPublicKey to produce a full BRID identity map.
//
// Limitation: addresses that have NEVER sent a transaction have not revealed
// their public key on-chain. For those, the BRID signing step is still required.
// ---------------------------------------------------------------------------

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { Caip2Namespace } from "@peelbtc/types";
import {
  deriveBitcoinAddress,
  deriveStacksAddress,
  deriveEvmAddress,
} from "../address/index.js";
import type { BridIdentityMap } from "./recover.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecipientRecoveryOptions {
  /**
   * Hiro API base URL for Stacks address recovery.
   * Defaults to https://api.hiro.so (mainnet) or https://api.testnet.hiro.so.
   */
  hiroBaseUrl?: string;
  /**
   * Mempool.space base URL for Bitcoin address recovery.
   * Defaults to https://mempool.space/api.
   */
  bitcoinApiUrl?: string;
  /** Whether to use testnet APIs. Defaults to false. */
  testnet?: boolean;
}

// ---------------------------------------------------------------------------
// buildIdentityFromPublicKey
// ---------------------------------------------------------------------------

/**
 * Build a complete BRID identity map directly from a known compressed public key,
 * without requiring a BRID message signature.
 *
 * Use this when the public key has been recovered via on-chain data
 * (Stacks tx, Bitcoin witness, or EVM tx).
 *
 * @param pubkey   33-byte compressed secp256k1 public key (Uint8Array or hex string).
 * @param testnet  Derive testnet addresses. Defaults to false.
 */
export function buildIdentityFromPublicKey(
  pubkey: Uint8Array | string,
  testnet = false,
): BridIdentityMap {
  const pubkeyBytes =
    typeof pubkey === "string" ? hexToBytes(pubkey.replace(/^0x/, "")) : pubkey;

  if (pubkeyBytes.length !== 33) {
    throw new Error(
      `expected 33-byte compressed pubkey, got ${pubkeyBytes.length} bytes`,
    );
  }

  const pubkeyHex = bytesToHex(pubkeyBytes);
  const { address: evmAddress } = deriveEvmAddress(pubkeyBytes, testnet);

  const evmLayers = ["bob", "rootstock", "citrea"].map(layer => ({
    address: evmAddress,
    layer,
    namespace: Caip2Namespace.Eip155,
    format: "eip55",
    testnet,
  }));

  const bitcoinDerived = deriveBitcoinAddress(pubkeyBytes, testnet);

  return {
    root: bitcoinDerived.address,
    publicKey: pubkeyHex,
    derived: [
      bitcoinDerived,
      deriveStacksAddress(pubkeyBytes, testnet),
      ...evmLayers,
    ],
  };
}

// ---------------------------------------------------------------------------
// recoverPublicKeyFromAddress (Stacks + Bitcoin)
// ---------------------------------------------------------------------------

/**
 * Attempt to recover the compressed secp256k1 public key from a Stacks or
 * Bitcoin address using on-chain transaction data.
 *
 * For EVM (0x...) addresses, use `recoverPublicKeyFromEvmAddress` in @peelbtc/sdk.
 *
 * Returns null if the address has no spending history or recovery fails.
 */
export async function recoverPublicKeyFromAddress(
  address: string,
  options: RecipientRecoveryOptions = {},
): Promise<Uint8Array | null> {
  const addr = address.trim();

  if (/^S[PT]/.test(addr)) {
    return recoverFromStacksAddress(addr, options);
  }
  if (/^(bc1|tb1|1|3|m|n|2)/.test(addr)) {
    return recoverFromBitcoinAddress(addr, options);
  }

  return null;
}

/**
 * Recover the full BRID identity map for a Stacks or Bitcoin recipient from
 * their on-chain address. Returns null if recovery fails.
 *
 * For EVM recipients, use `recoverRecipientIdentity` in @peelbtc/sdk.
 */
export async function recoverRecipientIdentity(
  address: string,
  options: RecipientRecoveryOptions = {},
): Promise<BridIdentityMap | null> {
  const pubkey = await recoverPublicKeyFromAddress(address, options);
  if (!pubkey) return null;
  return buildIdentityFromPublicKey(pubkey, options.testnet ?? false);
}

// ---------------------------------------------------------------------------
// Stacks recovery
//
// Any signed Stacks transaction allows ECDSA recovery of the compressed pubkey
// from the (preSignSigHash, v||r||s signature) stored in the spending condition.
//
// Flow:
//   1. GET /extended/v1/address/{addr}/transactions?limit=1 → txId
//   2. GET /extended/v1/tx/{txId}/raw → raw hex
//   3. deserializeTransaction(hex) → tx object
//   4. tx.signBegin() + sigHashPreSign() → preSignSigHash (the actual signed hash)
//   5. ECDSA recover compressed pubkey from (preSignSigHash, v||r||s)
// ---------------------------------------------------------------------------

async function recoverFromStacksAddress(
  address: string,
  options: RecipientRecoveryOptions,
): Promise<Uint8Array | null> {
  const testnet = options.testnet ?? address.startsWith("ST");
  const base = options.hiroBaseUrl ?? (testnet
    ? "https://api.testnet.hiro.so"
    : "https://api.hiro.so");

  try {
    // Step 1: Find any signed transaction from this address
    const listRes = await fetch(
      `${base}/extended/v1/address/${address}/transactions?limit=1&offset=0`,
    );
    if (!listRes.ok) return null;

    const listData = (await listRes.json()) as {
      results?: Array<{ tx_id: string }>;
    };
    const txId = listData.results?.[0]?.tx_id;
    if (!txId) return null;

    // Step 2: Fetch raw transaction hex
    const rawRes = await fetch(`${base}/extended/v1/tx/${txId}/raw`);
    if (!rawRes.ok) return null;
    const rawData = (await rawRes.json()) as { raw_tx: string };
    const rawHex = rawData.raw_tx?.replace(/^0x/, "");
    if (!rawHex) return null;

    // Step 3: Deserialize
    const { deserializeTransaction, sigHashPreSign } = await import("@stacks/transactions");
    const tx = deserializeTransaction(rawHex);

    const sc = tx.auth.spendingCondition as {
      signature: { data: string };
      fee: bigint;
      nonce: bigint;
    };
    if (!sc?.signature?.data || sc.signature.data.replace(/^0+$/, "") === "") {
      return null; // unsigned or empty signature
    }

    // Step 4: Reconstruct the pre-sign hash (what was actually signed)
    const sigHash = tx.signBegin();
    const preSignSigHash = sigHashPreSign(
      sigHash,
      tx.auth.authType,
      sc.fee,
      sc.nonce,
    );

    // Step 5: ECDSA recover — Stacks signature format is v(2) || r(64) || s(64)
    const sigHex = sc.signature.data;
    if (sigHex.length !== 130) return null;

    const recoveryId = parseInt(sigHex.slice(0, 2), 16); // 0 or 1
    const rBytes = hexToBytes(sigHex.slice(2, 66));
    const sBytes = hexToBytes(sigHex.slice(66, 130));
    const msgHashBytes = hexToBytes(preSignSigHash);

    // noble/curves v2: Signature.fromHex(r||s hex).addRecoveryBit(v).recoverPublicKey(hash)
    const rsHex = bytesToHex(rBytes) + bytesToHex(sBytes); // 64-byte r||s as hex
    return secp256k1.Signature
      .fromHex(rsHex)
      .addRecoveryBit(recoveryId)
      .recoverPublicKey(msgHashBytes)
      .toBytes(true); // compressed 33-byte pubkey
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bitcoin recovery
//
// P2WPKH spending transactions expose the compressed public key directly in
// the input witness: witness[0] = signature, witness[1] = 33-byte pubkey.
//
// No ECDSA math needed — the pubkey is stored verbatim in the witness.
//
// Note: addresses that have ONLY received (never spent) have not revealed
// their pubkey on-chain. Recovery returns null in that case.
// ---------------------------------------------------------------------------

async function recoverFromBitcoinAddress(
  address: string,
  options: RecipientRecoveryOptions,
): Promise<Uint8Array | null> {
  const base = options.bitcoinApiUrl ?? "https://mempool.space/api";

  try {
    // Find any transaction where this address is an INPUT (spending tx)
    const txsRes = await fetch(`${base}/address/${address}/txs`);
    if (!txsRes.ok) return null;

    const txs = (await txsRes.json()) as Array<{
      vin?: Array<{
        prevout?: { scriptpubkey_address?: string };
        witness?: string[];
      }>;
    }>;

    for (const tx of txs) {
      for (const input of tx.vin ?? []) {
        if (input.prevout?.scriptpubkey_address !== address) continue;
        const witness = input.witness;
        if (!witness || witness.length < 2) continue;

        // P2WPKH witness: [<signature (DER)>, <33-byte-compressed-pubkey>]
        const pubkeyHex = witness[1];
        if (pubkeyHex.length !== 66) continue; // must be 33 bytes
        if (!pubkeyHex.startsWith("02") && !pubkeyHex.startsWith("03")) continue;

        return hexToBytes(pubkeyHex);
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
