// ---------------------------------------------------------------------------
// Balance types — returned by fetchBalances() in @peelbtc/sdk
//
// Design principles:
//   - All amounts are bigint in smallest unit (satoshis or wei) — no floats
//   - isBtc marks assets that contribute to totalBtcSats
//   - BTC-denominated EVM assets (RBTC, cBTC) are stored as wei;
//     the orchestrator converts to satoshis before summing
//   - Non-BTC native assets (STX, ETH) appear in layers[] for context
//     but isBtc = false and they never enter totalBtcSats
// ---------------------------------------------------------------------------

/** Whether a balance entry represents a native chain asset or a token. */
export type BalanceKind = "native" | "token";

/**
 * Balance for a single asset on a single layer.
 * One LayerBalance per asset — a layer with both a native and a token asset
 * (e.g. BOB: ETH + tBTC) will have two entries.
 */
export interface LayerBalance {
  /** Layer identifier — "bitcoin", "stacks", "bob", "rootstock", "citrea" */
  layer: string;

  /** The address queried */
  address: string;

  /** Asset symbol — "BTC", "STX", "sBTC", "ETH", "tBTC", "RBTC", "cBTC" */
  asset: string;

  /** Whether this is a native chain asset or a token contract */
  kind: BalanceKind;

  /**
   * Raw balance in smallest unit.
   * - Bitcoin / sBTC: satoshis (8 decimals)
   * - STX: microSTX (6 decimals)
   * - ETH / tBTC / RBTC / cBTC: wei (18 decimals)
   *
   * Use `decimals` to convert to a human-readable amount.
   */
  balance: bigint;

  /** Number of decimal places for this asset */
  decimals: number;

  /**
   * Whether this asset is BTC-denominated and should be included in
   * `totalBtcSats`. True for: BTC, sBTC, tBTC, RBTC, cBTC.
   * False for: STX, ETH.
   */
  isBtc: boolean;

  /** Whether this balance was fetched from a testnet */
  testnet: boolean;

  /**
   * Set when the fetch for this asset failed. The balance will be 0n.
   * Other layers are unaffected — failures are isolated per asset.
   */
  error?: string;
}

/**
 * Aggregated balance map returned by fetchBalances().
 *
 * Use `totalBtcSats` for the single unified BTC balance.
 * Use `layers` for the per-layer breakdown (wallet UI, debugging).
 */
export interface BalanceMap {
  /** Per-asset balances across all layers */
  layers: LayerBalance[];

  /**
   * Total BTC held across all layers, in satoshis.
   *
   * Sum of all LayerBalance entries where isBtc = true, with EVM wei
   * values converted to satoshis (wei / 10^10).
   *
   * Only includes successfully fetched balances — failed fetches
   * contribute 0n rather than causing the whole total to fail.
   */
  totalBtcSats: bigint;

  /** Unix timestamp (ms) when the fetch was initiated */
  fetchedAt: number;
}

/**
 * Optional RPC/API URL overrides.
 * Falls back to the public endpoints in the NETWORKS registry when omitted.
 * Provide your own node URLs for production use.
 */
export interface RpcOverrides {
  bitcoin?: string;
  stacks?: string;
  bob?: string;
  rootstock?: string;
  citrea?: string;
}
