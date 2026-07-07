// ---------------------------------------------------------------------------
// Caip2 — full CAIP-2 chain identifiers for all supported networks
// ---------------------------------------------------------------------------

/**
 * Full CAIP-2 chain identifiers for all networks supported by Peel.
 * Use these values anywhere a CAIP-2 chain id is expected (e.g. WalletConnect,
 * EIP-6963, NetworkConfig.caip2).
 *
 * Format: `<namespace>:<reference>`
 * Reference: https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md
 */
export enum Caip2 {
  // ---- Bitcoin (bip122) --------------------------------------------------
  /** Bitcoin mainnet — genesis block hash prefix */
  BitcoinMainnet  = "bip122:000000000019d6689c085ae165831e93",
  /** Bitcoin testnet3 — testnet3 genesis block hash prefix */
  BitcoinTestnet  = "bip122:000000000933ea01ad0ee984209779ba",

  // ---- Stacks (stacks) ---------------------------------------------------
  /** Stacks mainnet */
  StacksMainnet   = "stacks:1",
  /** Stacks testnet — high bit (0x80000000) signals testnet */
  StacksTestnet   = "stacks:2147483648",

  // ---- BOB (eip155) ------------------------------------------------------
  /** BOB (Build on Bitcoin) mainnet */
  BobMainnet      = "eip155:60808",
  /** BOB testnet */
  BobTestnet      = "eip155:808",

  // ---- Rootstock (eip155) ------------------------------------------------
  /** Rootstock mainnet */
  RootstockMainnet = "eip155:30",
  /** Rootstock testnet */
  RootstockTestnet = "eip155:31",

  // ---- Citrea (eip155) ---------------------------------------------------
  /** Citrea mainnet */
  CitreaMainnet   = "eip155:4114",
  /** Citrea testnet */
  CitreaTestnet   = "eip155:5115",
}

// ---------------------------------------------------------------------------
// Caip2Namespace — CAIP-2 namespace prefixes (derivation rule families)
// ---------------------------------------------------------------------------

/**
 * CAIP-2 namespace prefixes used by BRID derivation rules.
 * Each namespace maps to exactly one address derivation procedure.
 *
 * Use this type for the `namespace` field on `DerivedAddress` — it correctly
 * represents that a derived address belongs to a namespace family, not a
 * specific chain. This matters for EVM where one address is valid on BOB,
 * Rootstock, and Citrea simultaneously.
 */
export enum Caip2Namespace {
  /** Bitcoin L1 — P2WPKH bech32 derivation */
  Bip122 = "bip122",
  /** Stacks — c32check derivation */
  Stacks = "stacks",
  /** All EVM-compatible chains (BOB, Rootstock, Citrea, ...) — keccak256 derivation */
  Eip155 = "eip155",
}

// ---------------------------------------------------------------------------
// NetworkConfig + AssetConfig — shape of the Peel chain registry (Grove)
// ---------------------------------------------------------------------------

/**
 * Static configuration for a supported Bitcoin network or L2.
 * Stored in the Grove registry inside @peelbtc/core.
 */
export interface NetworkConfig {
  /** Unique network identifier, e.g. "bitcoin", "stacks", "bob" */
  id: string;

  /** Human-readable name, e.g. "Bitcoin", "Stacks", "BOB" */
  name: string;

  /**
   * CAIP-2 chain identifier for interoperability with WalletConnect,
   * EIP-6963, and other wallet standards.
   * e.g. "bip122:000000000019d6689c085ae165831e93" (Bitcoin mainnet)
   *      "stacks:1" (Stacks mainnet)
   *      "eip155:60808" (BOB mainnet)
   */
  caip2: string;

  /** Symbol of the network's native asset, e.g. "BTC", "STX" */
  nativeAsset: string;

  /** RPC or API base URL */
  rpcUrl: string;

  /** Block explorer base URL */
  explorerUrl: string;

  /** Address format identifier, e.g. "bech32", "c32check", "evm-hex" */
  addressFormat: string;

  /** Average block time in seconds */
  avgBlockTimeSecs: number;

  /** Whether this is a testnet */
  testnet: boolean;
}

/**
 * Static configuration for a supported asset.
 * Covers both native assets (BTC) and bridged/wrapped BTC variants
 * (sBTC, tBTC, cBTC, rBTC).
 */
export interface AssetConfig {
  /** Asset symbol, e.g. "BTC", "sBTC", "tBTC" */
  symbol: string;

  /** Human-readable name, e.g. "Bitcoin", "Stacks BTC", "Threshold BTC" */
  name: string;

  /** Network id this asset lives on */
  network: string;

  /** Number of decimal places. Bitcoin and all variants use 8. */
  decimals: number;

  /** Whether this is a bridged/wrapped form of BTC */
  isBridgedBtc: boolean;

  /**
   * For contract-based assets (SIP-010, ERC-20):
   * the deployed contract address.
   */
  contractAddress?: string;

  /**
   * For Stacks SIP-010 tokens: the contract name component.
   * e.g. "sbtc-token" from "SP...contract-name"
   */
  contractName?: string;

  /**
   * Bridge adapter id used to acquire this asset from BTC L1.
   * Only set for bridged assets.
   */
  bridgeAdapterId?: string;
}

/**
 * Structured result returned by all `derive*Address` functions in @peelbtc/core.
 */
export interface DerivedAddress {
  /** The encoded address string (e.g. "bc1q...", "SP...", "0x...") */
  address: string;

  /** Human-readable layer identifier, e.g. "bitcoin", "stacks", "evm" */
  layer: string;

  /** CAIP-2 namespace for this derivation rule — identifies which derivation procedure was used */
  namespace: Caip2Namespace;

  /** Encoding format, e.g. "p2wpkh", "c32check", "eip55" */
  format: string;

  /** Whether this address is for a testnet */
  testnet: boolean;
}
