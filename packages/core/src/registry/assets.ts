import type { AssetConfig } from "@peelbtc/types";

// ---------------------------------------------------------------------------
// ASSETS — static registry of all supported assets
//
// Covers Bitcoin's native BTC and all bridged/wrapped BTC variants used
// across Peel's supported layers.
//
// Contract addresses are included for SIP-010 (Stacks) and ERC-20 (EVM)
// assets. Native assets (BTC, RBTC, cBTC) have no contractAddress.
//
// NOTE: Contract addresses for EVM chains should be verified against
// the canonical bridge deployment registries before use in production.
// ---------------------------------------------------------------------------

export const ASSETS: readonly AssetConfig[] = [

  // ---- Bitcoin L1 ------------------------------------------------------

  {
    symbol: "BTC",
    name: "Bitcoin",
    network: "bitcoin",
    decimals: 8,
    isBridgedBtc: false,
  },

  {
    symbol: "BTC",
    name: "Bitcoin (Testnet)",
    network: "bitcoin-testnet",
    decimals: 8,
    isBridgedBtc: false,
  },

  // ---- Stacks ----------------------------------------------------------
  // sBTC: SIP-010 fungible token, 1:1 backed by BTC locked on Bitcoin L1
  // via the sBTC decentralized peg protocol.

  {
    symbol: "STX",
    name: "Stacks",
    network: "stacks",
    decimals: 6,
    isBridgedBtc: false,
  },

  {
    symbol: "sBTC",
    name: "Stacks BTC",
    network: "stacks",
    decimals: 8,
    isBridgedBtc: true,
    // sBTC v2 — mainnet contract deployed by Stacks Foundation
    contractAddress: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
    contractName: "sbtc-token",
    bridgeAdapterId: "sbtc",
  },

  {
    symbol: "sBTC",
    name: "Stacks BTC (Testnet)",
    network: "stacks-testnet",
    decimals: 8,
    isBridgedBtc: true,
    contractAddress: "ST3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
    contractName: "sbtc-token",
    bridgeAdapterId: "sbtc",
  },

  // ---- BOB (Build on Bitcoin) ------------------------------------------
  // tBTC: ERC-20, bridged via Threshold Network's tBTC v2 protocol.
  // BTC deposited to the Threshold bridge is minted as tBTC on the target
  // EVM chain. BOB uses tBTC as its canonical BTC representation.

  {
    symbol: "tBTC",
    name: "Threshold BTC",
    network: "bob",
    decimals: 18, // tBTC uses 18 decimals (ERC-20 convention)
    isBridgedBtc: true,
    // tBTC v2 on BOB mainnet (chain 60808) — verify against:
    // https://github.com/thesis/tbtc-v2/blob/main/docs/rfc/rfc-8.adoc
    contractAddress: "0xBBa2eF945D523C4e2608C9E1214C2Cc64D4fc2e2",
    bridgeAdapterId: "tbtc",
  },

  // ---- Rootstock -------------------------------------------------------
  // RBTC: native asset of Rootstock, pegged 1:1 to BTC via the RSK
  // Federation's two-way peg (merge-mining backed). No contract address —
  // RBTC is transferred as native ETH-equivalent value on Rootstock.

  {
    symbol: "RBTC",
    name: "Rootstock BTC",
    network: "rootstock",
    decimals: 18, // EVM native asset convention
    isBridgedBtc: true,
    // No contractAddress — RBTC is the native gas asset on Rootstock
    bridgeAdapterId: "rbtc",
  },

  {
    symbol: "tRBTC",
    name: "Rootstock BTC (Testnet)",
    network: "rootstock-testnet",
    decimals: 18,
    isBridgedBtc: true,
    bridgeAdapterId: "rbtc",
  },

  // ---- Citrea ----------------------------------------------------------
  // cBTC: native asset of Citrea. BTC is locked on Bitcoin L1 via the
  // Clementine bridge (ZK-proven BitVM2 design); cBTC is minted 1:1 on
  // Citrea. No contract address — cBTC is the native gas asset on Citrea.

  {
    symbol: "cBTC",
    name: "Citrea BTC",
    network: "citrea",
    decimals: 18, // EVM native asset convention
    isBridgedBtc: true,
    // No contractAddress — cBTC is the native gas asset on Citrea
    bridgeAdapterId: "cbtc",
  },

  {
    symbol: "cBTC",
    name: "Citrea BTC (Testnet)",
    network: "citrea-testnet",
    decimals: 18,
    isBridgedBtc: true,
    bridgeAdapterId: "cbtc",
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Return all assets for a given network id. */
export function getAssetsForNetwork(networkId: string): AssetConfig[] {
  return ASSETS.filter((a) => a.network === networkId);
}

/** Return all bridged BTC assets (excludes native BTC and STX). */
export function getBridgedBtcAssets(): AssetConfig[] {
  return ASSETS.filter((a) => a.isBridgedBtc);
}

/** Return the asset for a given network + symbol, or undefined. */
export function getAsset(
  networkId: string,
  symbol: string,
): AssetConfig | undefined {
  return ASSETS.find((a) => a.network === networkId && a.symbol === symbol);
}
