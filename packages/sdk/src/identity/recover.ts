// ---------------------------------------------------------------------------
// EVM recipient recovery — derive BRID identity from an EVM (0x...) address
//
// Recovers the compressed secp256k1 public key from any signed EVM transaction.
// From the pubkey, all BRID layer addresses (Bitcoin, Stacks, EVM) are derived.
//
// This lives in @peelbtc/sdk (not @peelbtc/core) because it requires viem
// for proper EVM transaction serialization and public key recovery.
//
// Approach:
//   1. Find a transaction sent FROM the address
//      a. Blockscout-compatible explorer API (fast, if URL provided)
//      b. Scan last N blocks via eth_getBlockByNumber (fallback)
//   2. Use viem's recoverPublicKey with the transaction's signing hash
//   3. Verify the derived address matches tx.from
//   4. Build full BRID identity map from the recovered pubkey
//
// Limitation: addresses that have never sent a transaction have not revealed
// their public key on-chain. Returns null in that case.
// ---------------------------------------------------------------------------

import {
  recoverPublicKey as viemRecoverPublicKey,
  keccak256,
  serializeTransaction,
  parseTransaction,
  type Hex,
} from "viem";
import {
  bob, rootstock, citrea,
  bobSepolia, rootstockTestnet, citreaTestnet,
} from "viem/chains";
import { createEvmClient } from "../balances/evm-client.js";
import {
  buildIdentityFromPublicKey,
  type RecipientRecoveryOptions,
} from "@peelbtc/core";
import type { BridIdentityMap } from "@peelbtc/core";

export type EvmChain = "bob" | "rootstock" | "citrea";

export interface EvmRecoveryOptions extends RecipientRecoveryOptions {
  /**
   * EVM chain to query for transactions. Determines the RPC URL.
   * Defaults to "bob".
   */
  evmChain?: EvmChain;
  /**
   * Override the RPC URL. If omitted, uses the viem default for the chain.
   */
  evmRpcUrl?: string;
  /**
   * Blockscout-compatible explorer API base URL for finding transactions efficiently.
   * Example: "https://explorer.gobob.xyz"
   * If omitted, falls back to scanning recent blocks (slower).
   */
  evmExplorerApiUrl?: string;
  /**
   * Maximum number of recent blocks to scan when no explorer API is provided.
   * Default: 100.
   */
  evmMaxBlockScan?: number;
}

const CHAIN_MAP = {
  bob:       { mainnet: bob,       testnet: bobSepolia },
  rootstock: { mainnet: rootstock, testnet: rootstockTestnet },
  citrea:    { mainnet: citrea,    testnet: citreaTestnet },
};

/**
 * Recover the full BRID identity map for an EVM recipient from their on-chain
 * address, without requiring any interaction from them.
 *
 * Returns null if the address has no signed transaction history.
 */
export async function recoverEvmRecipientIdentity(
  address: string,
  options: EvmRecoveryOptions = {},
): Promise<BridIdentityMap | null> {
  const pubkey = await recoverPublicKeyFromEvmAddress(address, options);
  if (!pubkey) return null;
  return buildIdentityFromPublicKey(pubkey, options.testnet ?? false);
}

/**
 * Recover the compressed secp256k1 public key from an EVM address using
 * any signed transaction in the chain's history.
 *
 * Returns null if recovery fails.
 */
export async function recoverPublicKeyFromEvmAddress(
  address: string,
  options: EvmRecoveryOptions = {},
): Promise<Uint8Array | null> {
  const testnet = options.testnet ?? false;
  const chainName = options.evmChain ?? "bob";
  const chain = CHAIN_MAP[chainName][testnet ? "testnet" : "mainnet"];
  const rpcUrl = options.evmRpcUrl ?? chain.rpcUrls.default.http[0];

  try {
    // Step 1: Find any transaction FROM this address
    let txHash: string | null = null;

    if (options.evmExplorerApiUrl) {
      txHash = await findTxViaExplorer(address, options.evmExplorerApiUrl);
    }

    if (!txHash) {
      txHash = await findTxViaBlockScan(address, rpcUrl, options.evmMaxBlockScan ?? 100);
    }

    if (!txHash) return null;

    // Step 2: Recover pubkey from the transaction
    return recoverFromTxHash(txHash as Hex, rpcUrl, chain.id);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Explorer API lookup (Blockscout v2)
// ---------------------------------------------------------------------------

async function findTxViaExplorer(
  address: string,
  explorerApiUrl: string,
): Promise<string | null> {
  try {
    const url = `${explorerApiUrl}/api/v2/addresses/${address}/transactions?filter=from&page=1&page_size=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ hash: string }> };
    return data.items?.[0]?.hash ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Block scan fallback
// ---------------------------------------------------------------------------

async function findTxViaBlockScan(
  address: string,
  rpcUrl: string,
  maxBlocks: number,
): Promise<string | null> {
  const addrLower = address.toLowerCase();

  const latestHex = await jsonRpc(rpcUrl, "eth_blockNumber", []) as string;
  const latestBlock = parseInt(latestHex, 16);

  for (let i = 0; i < maxBlocks; i++) {
    const blockNum = `0x${(latestBlock - i).toString(16)}`;
    const block = await jsonRpc(rpcUrl, "eth_getBlockByNumber", [blockNum, true]) as {
      transactions?: Array<{ hash: string; from: string }>;
    } | null;

    const match = block?.transactions?.find(tx => tx.from.toLowerCase() === addrLower);
    if (match) return match.hash;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public key recovery from a known transaction hash
// ---------------------------------------------------------------------------

async function recoverFromTxHash(
  txHash: Hex,
  rpcUrl: string,
  chainId: number,
): Promise<Uint8Array | null> {
  const rawTx = await jsonRpc(rpcUrl, "eth_getRawTransactionByHash", [txHash]) as string | null;

  if (!rawTx) {
    // Fallback: reconstruct from tx fields
    return recoverFromTxFields(txHash, rpcUrl, chainId);
  }

  try {
    // Parse the raw signed transaction to get the signing hash
    const parsed = parseTransaction(rawTx as Hex);
    const { r, s, v, yParity } = parsed as {
      r?: Hex; s?: Hex; v?: bigint; yParity?: number;
    };
    if (!r || !s) return null;

    // Serialize without signature to get the signing payload
    const unsigned = { ...parsed } as Record<string, unknown>;
    delete unsigned.r; delete unsigned.s; delete unsigned.v; delete unsigned.yParity;

    const signingHash = keccak256(serializeTransaction(unsigned as Parameters<typeof serializeTransaction>[0]));
    const signature = { r, s, v, yParity } as { r: Hex; s: Hex; v?: bigint; yParity?: number };

    const pubkeyHex = await viemRecoverPublicKey({ hash: signingHash, signature: signature as Parameters<typeof viemRecoverPublicKey>[0]["signature"] });

    // Compress the pubkey (viem returns uncompressed 65-byte "0x04..." key)
    return compressPublicKey(pubkeyHex);
  } catch {
    return recoverFromTxFields(txHash, rpcUrl, chainId);
  }
}

async function recoverFromTxFields(
  txHash: Hex,
  rpcUrl: string,
  _chainId: number,
): Promise<Uint8Array | null> {
  const tx = await jsonRpc(rpcUrl, "eth_getTransactionByHash", [txHash]) as {
    r?: string; s?: string; v?: string; from?: string;
    nonce?: string; gas?: string; gasPrice?: string;
    maxFeePerGas?: string; maxPriorityFeePerGas?: string;
    to?: string | null; value?: string; input?: string;
    chainId?: string; type?: string;
  } | null;

  if (!tx?.r || !tx?.s || !tx?.from) return null;

  try {
    // Build a viem-compatible transaction object for serialization
    const type = tx.type ? parseInt(tx.type, 16) : (tx.maxFeePerGas ? 2 : 0);

    let txObj: Parameters<typeof serializeTransaction>[0];
    if (type === 2) {
      txObj = {
        type: "eip1559",
        chainId: tx.chainId ? parseInt(tx.chainId, 16) : _chainId,
        nonce: tx.nonce ? parseInt(tx.nonce, 16) : 0,
        gas: tx.gas ? BigInt(tx.gas) : 21000n,
        maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : 0n,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : 0n,
        to: (tx.to ?? "0x0000000000000000000000000000000000000000") as Hex,
        value: tx.value ? BigInt(tx.value) : 0n,
        data: (tx.input ?? "0x") as Hex,
        accessList: [],
      };
    } else {
      txObj = {
        type: "legacy",
        chainId: tx.chainId ? parseInt(tx.chainId, 16) : _chainId,
        nonce: tx.nonce ? parseInt(tx.nonce, 16) : 0,
        gas: tx.gas ? BigInt(tx.gas) : 21000n,
        gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : 0n,
        to: (tx.to ?? "0x0000000000000000000000000000000000000000") as Hex,
        value: tx.value ? BigInt(tx.value) : 0n,
        data: (tx.input ?? "0x") as Hex,
      };
    }

    const signingHash = keccak256(serializeTransaction(txObj));
    const vBig = BigInt(tx.v ?? "0x0");
    const yParity = (vBig === 0n || vBig === 1n) ? Number(vBig)
      : (vBig === 27n || vBig === 28n) ? Number(vBig) - 27
      : Number(vBig % 2n);

    const rHex = (tx.r ?? "0x" + "0".repeat(64)).replace(/^0x/, "").padStart(64, "0");
    const sHex = (tx.s ?? "0x" + "0".repeat(64)).replace(/^0x/, "").padStart(64, "0");

    const pubkeyHex = await viemRecoverPublicKey({
      hash: signingHash,
      signature: {
        r: `0x${rHex}` as Hex,
        s: `0x${sHex}` as Hex,
        yParity,
      },
    });

    return compressPublicKey(pubkeyHex);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compress an uncompressed secp256k1 public key (65 bytes, 0x04 prefix)
 * to the 33-byte compressed form (0x02 or 0x03 prefix).
 */
function compressPublicKey(uncompressedHex: string): Uint8Array {
  const hex = uncompressedHex.replace(/^0x/, "");
  if (hex.length === 66) {
    // Already compressed (33 bytes)
    return hexToBytes(hex);
  }
  if (hex.length !== 130 || !hex.startsWith("04")) {
    throw new Error("expected 65-byte uncompressed pubkey");
  }
  const x = hex.slice(2, 66);
  const yLastByte = parseInt(hex.slice(128, 130), 16);
  const prefix = yLastByte % 2 === 0 ? "02" : "03";
  return hexToBytes(prefix + x);
}

async function jsonRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.result ?? null;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
