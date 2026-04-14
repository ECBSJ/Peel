import { Caip2 } from "@peelbtc/types";
import type { NetworkConfig } from "@peelbtc/types";

// ---------------------------------------------------------------------------
// NETWORKS — static registry of all supported chains
//
// Keyed by full CAIP-2 identifier so any code holding a Caip2 value can
// look up chain config in O(1) without string manipulation.
//
// RPC URLs are public endpoints suitable for development and low-volume use.
// Production deployments should override rpcUrl with a dedicated node or
// RPC provider (QuickNode, Alchemy, Hiro Platform, etc.).
// ---------------------------------------------------------------------------

export const NETWORKS: Readonly<Record<Caip2, NetworkConfig>> = {

  // ---- Bitcoin ---------------------------------------------------------

  [Caip2.BitcoinMainnet]: {
    id: "bitcoin",
    name: "Bitcoin",
    caip2: Caip2.BitcoinMainnet,
    nativeAsset: "BTC",
    rpcUrl: "https://mempool.space/api",
    explorerUrl: "https://mempool.space",
    addressFormat: "p2wpkh",
    avgBlockTimeSecs: 600,
    testnet: false,
  },

  [Caip2.BitcoinTestnet]: {
    id: "bitcoin-testnet",
    name: "Bitcoin Testnet",
    caip2: Caip2.BitcoinTestnet,
    nativeAsset: "BTC",
    rpcUrl: "https://mempool.space/testnet/api",
    explorerUrl: "https://mempool.space/testnet",
    addressFormat: "p2wpkh",
    avgBlockTimeSecs: 600,
    testnet: true,
  },

  // ---- Stacks ----------------------------------------------------------
  // Stacks blocks are anchored to Bitcoin — effective finality is ~600s.

  [Caip2.StacksMainnet]: {
    id: "stacks",
    name: "Stacks",
    caip2: Caip2.StacksMainnet,
    nativeAsset: "STX",
    rpcUrl: "https://api.hiro.so",
    explorerUrl: "https://explorer.hiro.so",
    addressFormat: "c32check",
    avgBlockTimeSecs: 600,
    testnet: false,
  },

  [Caip2.StacksTestnet]: {
    id: "stacks-testnet",
    name: "Stacks Testnet",
    caip2: Caip2.StacksTestnet,
    nativeAsset: "STX",
    rpcUrl: "https://api.testnet.hiro.so",
    explorerUrl: "https://explorer.hiro.so/?chain=testnet",
    addressFormat: "c32check",
    avgBlockTimeSecs: 600,
    testnet: true,
  },

  // ---- BOB (Build on Bitcoin) ------------------------------------------
  // OP Stack L2. Native asset is ETH (gas). BTC is bridged via tBTC v2
  // (Threshold Network). Block times are ~2s; finality follows OP Stack
  // challenge period (~7 days on mainnet, shorter on testnet).

  [Caip2.BobMainnet]: {
    id: "bob",
    name: "BOB",
    caip2: Caip2.BobMainnet,
    nativeAsset: "ETH",
    rpcUrl: "https://rpc.gobob.xyz",
    explorerUrl: "https://explorer.gobob.xyz",
    addressFormat: "eip55",
    avgBlockTimeSecs: 2,
    testnet: false,
  },

  [Caip2.BobTestnet]: {
    id: "bob-testnet",
    name: "BOB Testnet",
    caip2: Caip2.BobTestnet,
    nativeAsset: "ETH",
    rpcUrl: "https://testnet.rpc.gobob.xyz",
    explorerUrl: "https://testnet-explorer.gobob.xyz",
    addressFormat: "eip55",
    avgBlockTimeSecs: 2,
    testnet: true,
  },

  // ---- Rootstock -------------------------------------------------------
  // EVM-compatible sidechain merge-mined with Bitcoin. Native asset is RBTC
  // (1:1 peg with BTC via RSK Federation). ~30s block time.

  [Caip2.RootstockMainnet]: {
    id: "rootstock",
    name: "Rootstock",
    caip2: Caip2.RootstockMainnet,
    nativeAsset: "RBTC",
    rpcUrl: "https://public-node.rsk.co",
    explorerUrl: "https://explorer.rsk.co",
    addressFormat: "eip55",
    avgBlockTimeSecs: 30,
    testnet: false,
  },

  [Caip2.RootstockTestnet]: {
    id: "rootstock-testnet",
    name: "Rootstock Testnet",
    caip2: Caip2.RootstockTestnet,
    nativeAsset: "tRBTC",
    rpcUrl: "https://public-node.testnet.rsk.co",
    explorerUrl: "https://explorer.testnet.rsk.co",
    addressFormat: "eip55",
    avgBlockTimeSecs: 30,
    testnet: true,
  },

  // ---- Citrea ----------------------------------------------------------
  // ZK rollup anchored to Bitcoin. Native asset is cBTC — BTC locked on L1
  // via Clementine bridge, backed by ZK proofs. ~2s block time.

  [Caip2.CitreaMainnet]: {
    id: "citrea",
    name: "Citrea",
    caip2: Caip2.CitreaMainnet,
    nativeAsset: "cBTC",
    rpcUrl: "https://rpc.citrea.xyz",
    explorerUrl: "https://explorer.citrea.xyz",
    addressFormat: "eip55",
    avgBlockTimeSecs: 2,
    testnet: false,
  },

  [Caip2.CitreaTestnet]: {
    id: "citrea-testnet",
    name: "Citrea Testnet",
    caip2: Caip2.CitreaTestnet,
    nativeAsset: "cBTC",
    rpcUrl: "https://rpc.devnet.citrea.xyz",
    explorerUrl: "https://explorer.devnet.citrea.xyz",
    addressFormat: "eip55",
    avgBlockTimeSecs: 2,
    testnet: true,
  },
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Return the NetworkConfig for a given CAIP-2 id, or undefined if unknown. */
export function getNetwork(caip2: Caip2): NetworkConfig {
  return NETWORKS[caip2];
}

/** Return all mainnet NetworkConfigs. */
export function getMainnetNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS).filter((n) => !n.testnet);
}

/** Return all testnet NetworkConfigs. */
export function getTestnetNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS).filter((n) => n.testnet);
}
