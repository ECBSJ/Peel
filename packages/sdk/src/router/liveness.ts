// ---------------------------------------------------------------------------
// Network liveness checks
//
// Lightweight RPC pings to confirm a chain is reachable before routing.
// All checks run in parallel with a 5-second timeout per chain.
// A chain that times out or errors is marked alive=false and excluded from routing.
// ---------------------------------------------------------------------------

import type { NetworkLayer, NetworkLivenessResult } from "./types.js";
import { bob, rootstock, citreaTestnet, citrea } from "viem/chains";

const LIVENESS_TIMEOUT_MS = 5_000;

/** RPC endpoints per layer (mainnet). */
const RPC: Record<NetworkLayer, string> = {
  bitcoin:   "https://mempool.space/api/blocks/tip/height",
  stacks:    "https://api.hiro.so/extended/v1/status",
  bob:       bob.rpcUrls.default.http[0],
  rootstock: rootstock.rpcUrls.default.http[0],
  citrea:    citrea.rpcUrls.default.http[0],
};

/**
 * Check network liveness for a set of layers in parallel.
 * Returns one result per layer, sorted by the input order.
 */
export async function checkLiveness(
  layers: NetworkLayer[],
): Promise<NetworkLivenessResult[]> {
  const checks = layers.map(layer => checkLayer(layer));
  return Promise.all(checks);
}

async function checkLayer(layer: NetworkLayer): Promise<NetworkLivenessResult> {
  const checkedAt = Date.now();
  const url = RPC[layer];

  try {
    const start = Date.now();
    const result = await withTimeout(pingLayer(layer, url), LIVENESS_TIMEOUT_MS);
    const latencyMs = Date.now() - start;

    return {
      layer,
      alive: true,
      latencyMs,
      blockHeight: result,
      checkedAt,
    };
  } catch (err) {
    return {
      layer,
      alive: false,
      latencyMs: LIVENESS_TIMEOUT_MS,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function pingLayer(layer: NetworkLayer, url: string): Promise<string> {
  if (layer === "bitcoin") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const height = await res.text();
    return height.trim();
  }

  if (layer === "stacks") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { chain_tip?: { burn_block_height?: number } };
    return String(data.chain_tip?.burn_block_height ?? "unknown");
  }

  // EVM chains — eth_blockNumber JSON-RPC
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { result?: string };
  if (!data.result) throw new Error("no result");
  return String(parseInt(data.result, 16));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}
