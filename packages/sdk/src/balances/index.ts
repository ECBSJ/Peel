// ---------------------------------------------------------------------------
// fetchBalances — orchestrator for all layer balance fetchers
//
// Calls all 5 layers in parallel using Promise.allSettled. A single failing
// RPC does not prevent the others from returning. Failed entries carry an
// `error` field and contribute 0n to totalBtcSats.
//
// Conversion: EVM BTC-pegged assets (RBTC, cBTC, tBTC) are stored in wei
// (18 decimals). totalBtcSats converts them to satoshis by dividing by 10^10.
//   1 BTC = 10^8 satoshis = 10^18 wei
//   1 satoshi = 10^10 wei
//   sats = wei / 10^10
// ---------------------------------------------------------------------------

import { Caip2, type BalanceMap, type RpcOverrides, type LayerBalance } from "@peelbtc/types";
import { NETWORKS } from "@peelbtc/core";
import type { BridIdentityMap } from "@peelbtc/core";
import { fetchBitcoinBalance } from "./bitcoin.js";
import { fetchStacksBalances } from "./stacks.js";
import { fetchBobBalances } from "./bob.js";
import { fetchRootstockBalance } from "./rootstock.js";
import { fetchCitreaBalance } from "./citrea.js";

/** 1 satoshi = 10^10 wei. Used to convert EVM 18-decimal amounts to satoshis. */
const WEI_PER_SAT = 10n ** 10n;

/**
 * Convert an EVM wei amount (18 decimals) to satoshis (8 decimals).
 * Integer division — sub-satoshi precision is truncated.
 */
function weiToSats(wei: bigint): bigint {
  return wei / WEI_PER_SAT;
}

/**
 * Fetch native asset balances for all Peel-supported layers.
 *
 * Given a `BridIdentityMap` (from `buildBridIdentityMap` in @peelbtc/core),
 * queries each layer's public API and returns a `BalanceMap` with per-layer
 * breakdowns and a single `totalBtcSats` value.
 *
 * Layers queried:
 *   - Bitcoin    → BTC (native UTXO)
 *   - Stacks     → STX (native) + sBTC (SIP-010)
 *   - BOB        → ETH (native) + tBTC (ERC-20)
 *   - Rootstock  → RBTC (native, 1:1 BTC peg)
 *   - Citrea     → cBTC (native, 1:1 BTC peg)
 *
 * @param identity    BRID identity map from buildBridIdentityMap()
 * @param overrides   Optional RPC/API URL overrides per layer
 * @returns           BalanceMap with per-layer entries and totalBtcSats
 */
export async function fetchBalances(
  identity: BridIdentityMap,
  overrides: RpcOverrides = {},
): Promise<BalanceMap> {
  const fetchedAt = Date.now();
  const isTestnet = identity.root.startsWith("tb1");

  // Resolve addresses from the identity map by layer name
  const byLayer = Object.fromEntries(
    identity.derived.map((d) => [d.layer, d.address]),
  );

  const btcAddress = byLayer["bitcoin"] ?? identity.root;
  const stacksAddress = byLayer["stacks"];
  const evmAddress = byLayer["bob"]; // same for bob, rootstock, citrea

  // Resolve RPC URLs from registry, with optional overrides
  const btcRpc =
    overrides.bitcoin ??
    NETWORKS[isTestnet ? Caip2.BitcoinTestnet : Caip2.BitcoinMainnet].rpcUrl;

  const stacksRpc =
    overrides.stacks ??
    NETWORKS[isTestnet ? Caip2.StacksTestnet : Caip2.StacksMainnet].rpcUrl;

  const bobRpc =
    overrides.bob ??
    NETWORKS[isTestnet ? Caip2.BobTestnet : Caip2.BobMainnet].rpcUrl;

  const rootstockRpc =
    overrides.rootstock ??
    NETWORKS[isTestnet ? Caip2.RootstockTestnet : Caip2.RootstockMainnet].rpcUrl;

  const citreaRpc =
    overrides.citrea ??
    NETWORKS[isTestnet ? Caip2.CitreaTestnet : Caip2.CitreaMainnet].rpcUrl;

  // Fetch all layers in parallel
  const [btcResult, stacksResult, bobResult, rootstockResult, citreaResult] =
    await Promise.allSettled([
      fetchBitcoinBalance(btcAddress, btcRpc, isTestnet),
      stacksAddress
        ? fetchStacksBalances(stacksAddress, stacksRpc, isTestnet)
        : Promise.resolve([] as LayerBalance[]),
      evmAddress
        ? fetchBobBalances(evmAddress as `0x${string}`, isTestnet, undefined, bobRpc)
        : Promise.resolve([] as LayerBalance[]),
      evmAddress
        ? fetchRootstockBalance(evmAddress, rootstockRpc, isTestnet)
        : Promise.resolve(null as LayerBalance | null),
      evmAddress
        ? fetchCitreaBalance(evmAddress, citreaRpc, isTestnet)
        : Promise.resolve(null as LayerBalance | null),
    ]);

  // Flatten all results into a single LayerBalance array
  const layers: LayerBalance[] = [];

  if (btcResult.status === "fulfilled") {
    layers.push(btcResult.value);
  }

  if (stacksResult.status === "fulfilled") {
    layers.push(...stacksResult.value);
  }

  if (bobResult.status === "fulfilled") {
    layers.push(...bobResult.value);
  }

  if (rootstockResult.status === "fulfilled" && rootstockResult.value !== null) {
    layers.push(rootstockResult.value);
  }

  if (citreaResult.status === "fulfilled" && citreaResult.value !== null) {
    layers.push(citreaResult.value);
  }

  // Compute totalBtcSats — sum of all BTC-denominated balances, normalized
  let totalBtcSats = 0n;
  for (const entry of layers) {
    if (!entry.isBtc || entry.error !== undefined) continue;

    if (entry.decimals === 8) {
      // Already in satoshis (BTC, sBTC)
      totalBtcSats += entry.balance;
    } else if (entry.decimals === 18) {
      // EVM wei → satoshis (RBTC, cBTC, tBTC)
      totalBtcSats += weiToSats(entry.balance);
    }
  }

  return { layers, totalBtcSats, fetchedAt };
}
