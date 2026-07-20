// ---------------------------------------------------------------------------
// Fee estimation
//
// Fetches live fee estimates per layer where available; falls back to
// conservative defaults. All results are expressed in satoshis for
// consistent cross-chain scoring.
//
// These are estimates — the actual fee paid at execution time may differ.
// ---------------------------------------------------------------------------

import type { NetworkLayer } from "./types.js";
import { rootstock, bob, citrea } from "viem/chains";

export interface FeeEstimate {
  feeSats: bigint;
  source: "live" | "estimated";
}

const SATS_PER_WEI = 10_000_000_000n; // 1 sat = 10^10 wei

// Conservative defaults (sats) used when live fetch fails.
const DEFAULTS: Record<string, bigint> = {
  bitcoin:          500n,    // ~2 sat/vbyte × 250 vbytes
  stacks:             1n,    // 2000 microSTX ≈ negligible
  bob:              200n,
  rootstock:        100n,
  citrea:           100n,
  "bridge:sbtc":  80_000n,  // DEFAULT_MAX_SIGNER_FEE
  "bridge:flyover":  0n,    // computed dynamically from amount
  "bridge:bob-gateway": 5_000n,
  "bridge:sbtc-out": 3_000n,
};

/**
 * Fetch fee estimates for a set of layers in parallel.
 * Each result includes the per-layer direct-transfer fee in sats.
 */
export async function fetchFeeEstimates(
  layers: NetworkLayer[],
): Promise<Map<NetworkLayer, FeeEstimate>> {
  const entries = await Promise.all(
    layers.map(async layer => [layer, await fetchLayerFee(layer)] as const),
  );
  return new Map(entries);
}

async function fetchLayerFee(layer: NetworkLayer): Promise<FeeEstimate> {
  try {
    switch (layer) {
      case "bitcoin": return await fetchBitcoinFee();
      case "stacks":  return { feeSats: DEFAULTS.stacks, source: "estimated" };
      case "bob":       return await fetchEvmFee(bob.rpcUrls.default.http[0]);
      case "rootstock": return await fetchEvmFee(rootstock.rpcUrls.default.http[0]);
      case "citrea":    return await fetchEvmFee(citrea.rpcUrls.default.http[0]);
    }
  } catch {
    return { feeSats: DEFAULTS[layer] ?? 500n, source: "estimated" };
  }
}

async function fetchBitcoinFee(): Promise<FeeEstimate> {
  const res = await fetch("https://mempool.space/api/v1/fees/recommended");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { halfHourFee?: number };
  const satsPerVbyte = BigInt(data.halfHourFee ?? 5);
  // P2WPKH-to-P2TR tx is ~250 vbytes
  return { feeSats: satsPerVbyte * 250n, source: "live" };
}

async function fetchEvmFee(rpcUrl: string): Promise<FeeEstimate> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 1 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { result?: string };
  if (!data.result) throw new Error("no result");
  const gasPriceWei = BigInt(data.result);
  // Native transfer: 21000 gas
  const feeSats = (gasPriceWei * 21_000n) / SATS_PER_WEI;
  return { feeSats: feeSats > 0n ? feeSats : 1n, source: "live" };
}

/** Estimated bridge fee for a given bridge and amount. */
export function bridgeFeeEstimate(
  bridge: "flyover" | "sbtc" | "bob-gateway" | "sbtc-out",
  amountSats: bigint,
): bigint {
  switch (bridge) {
    case "sbtc":
      return BigInt(DEFAULTS["bridge:sbtc"]);
    case "flyover":
      // 0.15% LP fee
      return (amountSats * 15n) / 10_000n;
    case "bob-gateway":
      return DEFAULTS["bridge:bob-gateway"];
    case "sbtc-out":
      return DEFAULTS["bridge:sbtc-out"];
  }
}

/** Estimated settlement time in seconds for a given bridge. */
export function bridgeTimeEstimate(
  bridge: "flyover" | "sbtc" | "bob-gateway" | "sbtc-out",
): number {
  switch (bridge) {
    case "sbtc":        return 20 * 60;   // ~20 min
    case "flyover":     return 40 * 60;   // ~40 min (mid of 20-60 range)
    case "bob-gateway": return 20 * 60;   // ~20 min
    case "sbtc-out":    return 60 * 60;   // ~1 hour
  }
}

/** Estimated settlement time for a direct transfer. */
export function directTimeEstimate(layer: NetworkLayer): number {
  switch (layer) {
    case "bitcoin":   return 10 * 60;  // ~10 min for 1 confirmation
    case "stacks":    return 10;       // ~10 seconds
    case "bob":       return 2;        // ~2 seconds
    case "rootstock": return 30;       // ~30 seconds
    case "citrea":    return 2;        // ~2 seconds
  }
}
