// ---------------------------------------------------------------------------
// sBTC Bridge — Peg-In (BTC → sBTC) and Peg-Out (sBTC → BTC)
//
// Mainnet only. Uses the sBTC Signers network operated by the Stacks Foundation.
//
// PEG-IN (BTC → sBTC) — agent-first flow:
//   1. buildSbtcDepositPlan()   — fetch signers pubkey, build P2TR deposit address
//   2. Agent constructs + signs + broadcasts a BTC tx to plan.depositAddress
//   3. notifySbtcDeposit()      — notify the Emily API about the BTC tx
//   4. pollSbtcDepositStatus()  — poll until sBTC is minted (~20 min, 1-2 BTC confs)
//
// PEG-OUT (sBTC → BTC) — uses existing Stacks tx pipeline:
//   1. prepareSbtcWithdrawalTx() — fetches nonce, builds unsigned Stacks contract
//                                  call, returns StacksTxPrepared with preSignSigHash
//   2. encodeStacksSignedTx()    — from stacks.ts, inject OWS signature
//   3. broadcastStacksTx()       — from stacks.ts, broadcast to Stacks network
//   4. pollSbtcWithdrawalStatus() — poll Emily API until BTC arrives (~6 BTC confs)
//
// Contracts (mainnet):
//   sBTC token:      SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
//   sBTC withdrawal: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal
//
// Emily API (mainnet): https://sbtc-emily.com
// ---------------------------------------------------------------------------

import {
  buildSbtcDepositAddress,
  SbtcApiClientMainnet,
  MAINNET,
  DEFAULT_RECLAIM_LOCK_TIME,
  DEFAULT_MAX_SIGNER_FEE,
} from "sbtc";
import {
  makeUnsignedContractCall,
  uintCV,
  tupleCV,
  bufferCV,
  PostConditionMode,
  sigHashPreSign,
  type StacksTransactionWire,
  type SingleSigSpendingCondition,
} from "@stacks/transactions";
import type { StacksTxPrepared } from "../transactions/stacks.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SBTC_WITHDRAWAL_CONTRACT_ADDRESS = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const SBTC_WITHDRAWAL_CONTRACT_NAME = "sbtc-withdrawal";
const EMILY_MAINNET = "https://sbtc-emily.com";

// ---------------------------------------------------------------------------
// BTC address deconstruction (peg-out helper)
// ---------------------------------------------------------------------------

// Clarity version bytes for BTC address types:
//   0x00 = P2PKH  (base58check v0,  20-byte hash)
//   0x01 = P2SH   (base58check v5,  20-byte hash)
//   0x04 = P2WPKH (bech32 witness v0, 20-byte program)
//   0x05 = P2WSH  (bech32 witness v0, 32-byte program)
//   0x06 = P2TR   (bech32m witness v1, 32-byte program)

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CHARSET_MAP = new Map(BECH32_CHARSET.split("").map((c, i) => [c, i]));

function bech32Decode(addr: string): { version: number; program: Uint8Array } | null {
  const lower = addr.toLowerCase();
  // Support both bech32 (bc1q) and bech32m (bc1p)
  if (!lower.startsWith("bc1")) return null;

  const sep = lower.lastIndexOf("1");
  if (sep < 1) return null;
  const data = lower.slice(sep + 1);
  if (data.length < 6) return null;

  // Decode base-32 data (skip 6-char checksum at end)
  const values: number[] = [];
  for (const c of data.slice(0, -6)) {
    const v = BECH32_CHARSET_MAP.get(c);
    if (v === undefined) return null;
    values.push(v);
  }

  if (values.length < 1) return null;
  const witnessVersion = values[0];
  const program5bit = values.slice(1);

  // Convert from 5-bit to 8-bit groups
  let acc = 0, bits = 0;
  const result: number[] = [];
  for (const value of program5bit) {
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }

  return { version: witnessVersion, program: new Uint8Array(result) };
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map(BASE58_ALPHABET.split("").map((c, i) => [c, i]));

function base58CheckDecode(addr: string): { version: number; hash: Uint8Array } | null {
  let num = 0n;
  for (const c of addr) {
    const v = BASE58_MAP.get(c);
    if (v === undefined) return null;
    num = num * 58n + BigInt(v);
  }
  // Convert to 25 bytes (1 version + 20 hash + 4 checksum)
  const bytes = new Uint8Array(25);
  for (let i = 24; i >= 0; i--) {
    bytes[i] = Number(num & 0xffn);
    num >>= 8n;
  }
  return { version: bytes[0], hash: bytes.slice(1, 21) };
}

/**
 * Decode a mainnet Bitcoin address into the Clarity-compatible
 * `{ version, hashbytes }` tuple required by `initiate-withdrawal-request`.
 *
 * Supported types: P2PKH (1...), P2SH (3...), P2WPKH (bc1q, 20 bytes),
 * P2WSH (bc1q, 32 bytes), P2TR (bc1p, 32 bytes).
 */
export function decodeBtcAddress(btcAddress: string): {
  version: Uint8Array; // 1 byte — Clarity buffer
  hashbytes: Uint8Array; // 20 or 32 bytes — Clarity buffer
} {
  const addr = btcAddress.trim();

  // bech32 / bech32m (segwit)
  if (addr.toLowerCase().startsWith("bc1")) {
    const decoded = bech32Decode(addr);
    if (!decoded) throw new Error(`cannot decode bech32 BTC address: ${btcAddress}`);

    let clarityVersion: number;
    if (decoded.version === 0 && decoded.program.length === 20) {
      clarityVersion = 0x04; // P2WPKH
    } else if (decoded.version === 0 && decoded.program.length === 32) {
      clarityVersion = 0x05; // P2WSH
    } else if (decoded.version === 1 && decoded.program.length === 32) {
      clarityVersion = 0x06; // P2TR
    } else {
      throw new Error(`unsupported segwit address version/length: v${decoded.version} len${decoded.program.length}`);
    }
    return {
      version: new Uint8Array([clarityVersion]),
      hashbytes: decoded.program,
    };
  }

  // base58check (legacy)
  const decoded = base58CheckDecode(addr);
  if (!decoded) throw new Error(`cannot decode base58check BTC address: ${btcAddress}`);

  if (decoded.version === 0x00) {
    return { version: new Uint8Array([0x00]), hashbytes: decoded.hash }; // P2PKH
  } else if (decoded.version === 0x05) {
    return { version: new Uint8Array([0x01]), hashbytes: decoded.hash }; // P2SH
  }

  throw new Error(`unrecognised BTC address version byte: 0x${decoded.version.toString(16)}`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Everything an agent needs to construct and broadcast the BTC deposit
 * transaction for a peg-in. The `depositAddress` is a P2TR address containing
 * two embedded tapscripts:
 *   - Deposit script: lets sBTC Signers sweep the UTXO and mint sBTC.
 *   - Reclaim script: lets the depositor reclaim after `reclaimLockTime` blocks.
 *
 * After broadcasting the BTC tx, call `notifySbtcDeposit()` to alert the Signers.
 */
export interface SbtcDepositPlan {
  /** P2TR address to send BTC to. This is the only required output. */
  depositAddress: string;
  /** Amount to send in satoshis. */
  amountSats: bigint;
  /**
   * Maximum fee in satoshis that the sBTC Signers may charge for sweeping the
   * deposit. Deducted from the minted sBTC amount if the actual fee is less.
   * Default: 80,000 sats.
   */
  maxSignerFee: number;
  /**
   * Number of Bitcoin blocks after which the depositor can reclaim funds if
   * the deposit is not processed. Default: 950 blocks (~1 week).
   */
  reclaimLockTime: number;
  /** Stacks address that will receive the minted sBTC. */
  stacksAddress: string;
  /** x-only 32-byte schnorr pubkey of the sBTC Signers aggregate (informational). */
  signersPublicKey: string;
  /**
   * The x-only 32-byte schnorr pubkey used in the reclaim tapscript.
   * This is the depositor's BTC pubkey with the `02`/`03` compression prefix
   * stripped (i.e. only the 32-byte x-coordinate).
   */
  reclaimPublicKey: string;
  /**
   * Estimated time to receive sBTC after 1-2 Bitcoin confirmations.
   * Approximately 20 minutes.
   */
  estimatedMintTimeSecs: number;
  /** @internal Deposit script — required by notifySbtcDeposit. */
  _depositScript: string;
  /** @internal Reclaim script — required by notifySbtcDeposit. */
  _reclaimScript: string;
}

export interface SbtcNotifyResponse {
  bitcoinTxid: string;
  bitcoinTxOutputIndex: number;
  recipient: string;
  amount: number;
  lastUpdateHeight: number;
  lastUpdateBlockHash: string;
  status: string;
  statusMessage: string;
  parameters: { maxFee: number; lockTime: number };
  reclaimScript: string;
  depositScript: string;
}

export interface SbtcDepositStatusEntry {
  bitcoinTxid: string;
  bitcoinTxOutputIndex: number;
  recipient: string;
  amount: number;
  status: "pending" | "confirmed" | "failed" | string;
  statusMessage: string;
  lastUpdateHeight: number;
  fulfillment?: {
    BitcoinTxid: string;
    StacksTxid: string;
    BitcoinBlockHeight: number;
    BtcFee: number;
  };
}

export interface SbtcWithdrawalStatusEntry {
  requestId: number;
  sender: string;
  recipient: string;
  amount: number;
  status: "pending" | "accepted" | "confirmed" | "failed" | string;
  txid?: string;
  lastUpdateHeight: number;
}

// ---------------------------------------------------------------------------
// buildSbtcDepositPlan
// ---------------------------------------------------------------------------

/**
 * Fetch the sBTC Signers' aggregate public key from Emily, build the P2TR
 * deposit address, and return everything the agent needs to construct and
 * broadcast the BTC deposit transaction.
 *
 * @param amountSats       Amount to bridge, in satoshis.
 * @param stacksAddress    Stacks address (SP...) that will receive the minted sBTC.
 * @param reclaimPublicKey The depositor's x-only 32-byte schnorr pubkey (strip
 *                         the `02`/`03` prefix from the OWS compressed pubkey).
 *                         Used in the reclaim tapscript so the depositor can
 *                         recover funds if the Signers don't process the deposit.
 * @param reclaimLockTime  BTC blocks before reclaim is possible (default: 950).
 * @param maxSignerFee     Max sats the Signers may charge for sweeping (default: 80_000).
 */
export async function buildSbtcDepositPlan(opts: {
  amountSats: bigint;
  stacksAddress: string;
  reclaimPublicKey: string;
  reclaimLockTime?: number;
  maxSignerFee?: number;
}): Promise<SbtcDepositPlan> {
  const {
    amountSats,
    stacksAddress,
    reclaimPublicKey,
    reclaimLockTime = DEFAULT_RECLAIM_LOCK_TIME,
    maxSignerFee = DEFAULT_MAX_SIGNER_FEE,
  } = opts;

  if (amountSats <= 0n) {
    throw new Error("amountSats must be greater than 0");
  }
  if (reclaimPublicKey.length !== 64) {
    throw new Error(
      "reclaimPublicKey must be a 32-byte x-only schnorr pubkey (64 hex chars). " +
        "Strip the 02/03 prefix from the OWS compressed pubkey.",
    );
  }

  const client = new SbtcApiClientMainnet();
  const signersPublicKey = await client.fetchSignersPublicKey();

  const deposit = buildSbtcDepositAddress({
    network: MAINNET,
    stacksAddress,
    signersPublicKey,
    reclaimLockTime,
    reclaimPublicKey,
    maxSignerFee,
  });

  return {
    depositAddress: deposit.address,
    amountSats,
    maxSignerFee,
    reclaimLockTime,
    stacksAddress,
    signersPublicKey,
    reclaimPublicKey,
    estimatedMintTimeSecs: 20 * 60, // ~20 min for 1-2 BTC confirmations
    _depositScript: deposit.depositScript,
    _reclaimScript: deposit.reclaimScript,
  };
}

// ---------------------------------------------------------------------------
// notifySbtcDeposit
// ---------------------------------------------------------------------------

/**
 * Notify the sBTC Signers (Emily API) of the BTC deposit transaction.
 * Call this immediately after the BTC tx appears in the mempool.
 * The Emily API requires the raw hex of the deposit transaction.
 *
 * @param plan       The deposit plan from buildSbtcDepositPlan.
 * @param btcTxHex   Raw hex of the broadcasted BTC transaction.
 */
export async function notifySbtcDeposit(
  plan: SbtcDepositPlan,
  btcTxHex: string,
): Promise<SbtcNotifyResponse> {
  const client = new SbtcApiClientMainnet();
  return client.notifySbtc({
    transaction: btcTxHex,
    depositScript: plan._depositScript,
    reclaimScript: plan._reclaimScript,
  }) as Promise<SbtcNotifyResponse>;
}

// ---------------------------------------------------------------------------
// pollSbtcDepositStatus
// ---------------------------------------------------------------------------

/**
 * Poll the Emily API for the status of a BTC deposit (peg-in).
 * The initial BTC deposit txid is from the BTC transaction the agent broadcast.
 *
 * @param btcTxid   The txid of the BTC deposit transaction.
 */
export async function pollSbtcDepositStatus(btcTxid: string): Promise<SbtcDepositStatusEntry> {
  const client = new SbtcApiClientMainnet();
  const result = await client.fetchDeposit(btcTxid);
  // fetchDeposit returns { deposits: [...] }
  const entry = (result as { deposits?: SbtcDepositStatusEntry[] }).deposits?.[0] ?? result;
  return entry as SbtcDepositStatusEntry;
}

// ---------------------------------------------------------------------------
// buildSbtcWithdrawal → prepareSbtcWithdrawalTx
// ---------------------------------------------------------------------------

/**
 * Fetch the sender's current nonce and build an unsigned Stacks contract call
 * to `initiate-withdrawal-request` on the sBTC withdrawal contract.
 *
 * Returns a `StacksTxPrepared` that feeds directly into the standard pipeline:
 *   `encodeStacksSignedTx` → `broadcastStacksTx` (both from @peelbtc/sdk stacks.ts)
 *
 * The contract call locks `amountSats + maxFeeSats` sBTC from the sender.
 * Once processed by the Signers (~6 BTC confirmations, ~1 hour), `amountSats`
 * BTC is sent to `btcRecipientAddress` and any unused fee is refunded as sBTC.
 *
 * @param stacksAddress       Sender's Stacks address (SP...). Must hold sBTC.
 * @param publicKey           Sender's 33-byte compressed pubkey, hex (from OWS).
 * @param btcRecipientAddress Bitcoin address to receive BTC. Supported types:
 *                            P2TR (bc1p...), P2WPKH (bc1q...), P2SH (3...),
 *                            P2PKH (1...).
 * @param amountSats          sBTC amount to withdraw, in satoshis.
 * @param maxFeeSats          Max fee for the Bitcoin sweep tx (default: 3_000n).
 * @param hiroBaseUrl         Override Hiro API base URL (for nonce fetching).
 */
export async function prepareSbtcWithdrawalTx(opts: {
  stacksAddress: string;
  publicKey: string;
  btcRecipientAddress: string;
  amountSats: bigint;
  maxFeeSats?: bigint;
  hiroBaseUrl?: string;
}): Promise<StacksTxPrepared> {
  const {
    stacksAddress,
    publicKey,
    btcRecipientAddress,
    amountSats,
    maxFeeSats = 3_000n,
    hiroBaseUrl,
  } = opts;

  if (amountSats <= 0n) {
    throw new Error("amountSats must be greater than 0");
  }

  const { version, hashbytes } = decodeBtcAddress(btcRecipientAddress);
  const recipientTuple = tupleCV({
    version: bufferCV(version),
    hashbytes: bufferCV(hashbytes),
  });

  // Fetch nonce (prefer mempool-aware endpoint)
  const nonce = await fetchNonce(stacksAddress, hiroBaseUrl);
  const fee = 2000n; // standard Stacks contract call fee

  const wire: StacksTransactionWire = await makeUnsignedContractCall({
    contractAddress: SBTC_WITHDRAWAL_CONTRACT_ADDRESS,
    contractName: SBTC_WITHDRAWAL_CONTRACT_NAME,
    functionName: "initiate-withdrawal-request",
    functionArgs: [uintCV(amountSats), recipientTuple, uintCV(maxFeeSats)],
    publicKey,
    network: "mainnet",
    nonce,
    fee,
    // Note: in production, add a strict post-condition:
    // sender sends exactly (amountSats + maxFeeSats) of sbtc-token.
    // PostConditionMode.Allow is used here to keep the module dependency-light.
    postConditionMode: PostConditionMode.Allow,
  });

  const sigHash = wire.signBegin();
  const preSignSigHash = sigHashPreSign(
    sigHash,
    wire.auth.authType,
    wire.auth.spendingCondition.fee,
    wire.auth.spendingCondition.nonce,
  );

  return {
    type: "sbtc-withdrawal" as StacksTxPrepared["type"],
    from: stacksAddress,
    to: `${SBTC_WITHDRAWAL_CONTRACT_ADDRESS}.${SBTC_WITHDRAWAL_CONTRACT_NAME}`,
    amount: amountSats,
    testnet: false,
    nonce,
    fee,
    preSignSigHash,
    _wire: wire,
  };
}

async function fetchNonce(address: string, hiroBaseUrl?: string): Promise<bigint> {
  const base = hiroBaseUrl ?? "https://api.hiro.so";
  try {
    const res = await fetch(`${base}/extended/v1/address/${address}/nonces`);
    if (res.ok) {
      const data = (await res.json()) as { possible_next_nonce: number };
      if (typeof data.possible_next_nonce === "number") {
        return BigInt(data.possible_next_nonce);
      }
    }
  } catch {}
  const res = await fetch(`${base}/v2/accounts/${address}?proof=0`);
  if (!res.ok) throw new Error(`failed to fetch nonce: HTTP ${res.status}`);
  const data = (await res.json()) as { nonce: number };
  return BigInt(data.nonce);
}

// ---------------------------------------------------------------------------
// pollSbtcWithdrawalStatus
// ---------------------------------------------------------------------------

/**
 * Poll the Emily API for the status of sBTC withdrawal requests from a sender.
 * Returns all withdrawal entries, most recent first.
 * BTC confirmation typically takes ~6 Bitcoin blocks (~1 hour).
 *
 * @param stacksAddress  The sender's Stacks address.
 */
export async function pollSbtcWithdrawalStatus(
  stacksAddress: string,
): Promise<SbtcWithdrawalStatusEntry[]> {
  const res = await fetch(`${EMILY_MAINNET}/withdrawal/sender/${stacksAddress}`);
  if (!res.ok) throw new Error(`Emily API error: HTTP ${res.status}`);
  const data = (await res.json()) as { withdrawals?: SbtcWithdrawalStatusEntry[] };
  return data.withdrawals ?? [];
}
