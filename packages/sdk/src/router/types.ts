// ---------------------------------------------------------------------------
// Router — shared types
// ---------------------------------------------------------------------------

import type { BridIdentityMap } from "@peelbtc/core";

export type NetworkLayer = "bitcoin" | "stacks" | "bob" | "rootstock" | "citrea";
export type BridgeName = "flyover" | "sbtc" | "bob-gateway";

// ---------------------------------------------------------------------------
// Intent (input)
// ---------------------------------------------------------------------------

export interface RouteIntent {
  /** Source wallet — provides all chain addresses and is used for balance scoring. */
  from: BridIdentityMap;
  /** Destination address in any supported format (Bitcoin, Stacks, EVM 0x...). */
  to: string;
  /** Amount to route in satoshis. */
  amountSats: bigint;

  /**
   * Required when `to` is a 0x... EVM address. Skips the receiver-activity
   * heuristic and routes directly to the specified chain.
   */
  destinationChain?: "bob" | "rootstock" | "citrea";

  /** Prefer a specific bridge if multiple options are available. */
  preferredBridge?: BridgeName;

  /** Exclude routes where the estimated bridge fee exceeds this (sats). */
  maxBridgeFeeSats?: bigint;

  /** Exclude routes that take longer than this to settle (seconds). */
  maxTimeSecs?: number;

  /**
   * Override the default scoring weights. Values are relative — they are
   * normalised internally so they do not need to sum to 100.
   */
  scoreWeights?: Partial<ScoreWeights>;

  /**
   * Human-readable note embedded alongside the Peel marker in the transaction.
   * Max 13 bytes UTF-8 (to fit within the 34-byte Stacks memo limit).
   */
  memo?: string;

  /**
   * Opt-in telemetry hook. Called with the fully resolved intent after scoring
   * but before the plan is returned. The engine has no network calls of its own
   * — the caller controls where this data goes (log, server, OP_RETURN, etc.).
   */
  onIntentResolved?: (intent: ResolvedIntent) => Promise<void>;
}

export interface ScoreWeights {
  /** Prefer routes that spend the sender's most liquid BTC asset. Default: 35. */
  senderBalance: number;
  /** Prefer chains where the receiver has most activity (highest balance). Default: 25. */
  receiverActivity: number;
  /** Prefer routes with lower total fees. Default: 25. */
  feeRate: number;
  /** Prefer routes that settle faster. Default: 15. */
  settlementTime: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  senderBalance: 35,
  receiverActivity: 25,
  feeRate: 25,
  settlementTime: 15,
};

// ---------------------------------------------------------------------------
// Plan (output)
// ---------------------------------------------------------------------------

export interface RoutePlan {
  intent: ResolvedIntent;
  /** Ordered steps the agent must execute. Each step is fully self-contained. */
  steps: RouteStep[];
}

export interface ResolvedIntent {
  /** UUID per routing decision — embedded in every Peel memo. */
  id: string;
  resolvedAt: number;
  sourceLayer: NetworkLayer;
  destinationLayer: NetworkLayer;
  destinationAddress: string;
  amountSats: bigint;
  route: "direct" | "bridge";
  bridge?: BridgeName;
  estimatedFeeSats: bigint;
  estimatedTimeSecs: number;
  networkChecks: NetworkLivenessResult[];
  recipientHint?: RecipientHint;
  /** All candidates scored, for transparency. */
  allCandidates: ScoredCandidate[];
}

// ---------------------------------------------------------------------------
// Route steps
// ---------------------------------------------------------------------------

export type RouteStep =
  | BtcSendStep
  | EvmTransferStep
  | StacksTransferStep
  | BridgeDepositStep
  | BridgeNotifyStep
  | SbtcWithdrawalStep;

/** Agent sends BTC to the given address. Include peelMemo as an OP_RETURN output. */
export interface BtcSendStep {
  type: "btc-send";
  from: string;
  to: string;
  amountSats: bigint;
  /**
   * Add as an extra OP_RETURN output (0 value).
   * Binary: PEEL(4) | version(1) | intentId(16) | userMemo(0-13)
   */
  peelMemo: EncodedMemo;
}

/**
 * Agent calls prepareRootstockTx / prepareBobTx / prepareCitreaTx,
 * signs with OWS, encodes, and broadcasts.
 * For native transfers, embed peelMemo in the tx `data` field.
 */
export interface EvmTransferStep {
  type: "evm-transfer";
  chain: "bob" | "rootstock" | "citrea";
  from: string;
  to: string;
  amountWei: bigint;
  asset: "ETH" | "RBTC" | "cBTC" | "wBTC";
  /** Present for ERC-20 transfers. */
  tokenContract?: string;
  /** Embed in tx `data` field for native transfers. Omit for ERC-20 (calldata occupied). */
  peelMemo?: EncodedMemo;
}

/**
 * Agent calls prepareStacksTx, signs with OWS Bitcoin signer, broadcasts.
 * STX transfers support a memo field; sBTC SIP-010 does not.
 */
export interface StacksTransferStep {
  type: "stacks-transfer";
  from: string;
  to: string;
  publicKey: string;
  asset: "STX" | "sBTC";
  amountSats: bigint;
  /** Embed in Stacks `memo` field for STX transfers, or as the SIP-010 `transfer` memo param for sBTC (both support 34-byte buff). */
  peelMemo?: EncodedMemo;
}

/**
 * Agent calls the bridge-specific setup function to get the deposit address,
 * then sends to that address.
 */
export interface BridgeDepositStep {
  type: "bridge-deposit";
  bridge: BridgeName;
  from: string;
  amountSats: bigint;
  estimatedFeeSats: bigint;
  estimatedTimeSecs: number;
  /** Bridge-specific setup parameters. Pass to the matching setup function. */
  params: SbtcDepositParams | FlyoverDepositParams | BobGatewayParams;
  peelMemo: EncodedMemo;
}

/** sBTC peg-in: call buildSbtcDepositPlan(params) to get the deposit address. */
export interface SbtcDepositParams {
  bridge: "sbtc";
  stacksAddress: string;
  reclaimPublicKey: string;
  amountSats: bigint;
  maxSignerFee?: number;
}

/** Flyover peg-in: call adapter.getPegInPaymentPlan(amountSats, recipientRskAddress). */
export interface FlyoverDepositParams {
  bridge: "flyover";
  recipientRskAddress: string;
  amountSats: bigint;
}

/** BOB Gateway: use `gateway-cli swap --src BTC --dst ETH:bob --amount <sats> --unsigned`. */
export interface BobGatewayParams {
  bridge: "bob-gateway";
  recipientBobAddress: string;
  amountSats: bigint;
}

/**
 * sBTC peg-in only: after broadcasting the BTC deposit tx, fetch the raw tx hex
 * from mempool.space and call notifySbtcDeposit(plan, txHex).
 */
export interface BridgeNotifyStep {
  type: "bridge-notify";
  bridge: "sbtc";
}

/**
 * sBTC peg-out: call prepareSbtcWithdrawalTx(params), sign with OWS, broadcast.
 * The Stacks tx locks amountSats + maxFeeSats sBTC. Signers send BTC to btcRecipient.
 */
export interface SbtcWithdrawalStep {
  type: "sbtc-withdrawal";
  from: string;
  publicKey: string;
  btcRecipient: string;
  amountSats: bigint;
  maxFeeSats: bigint;
}

// ---------------------------------------------------------------------------
// Peel memo
// ---------------------------------------------------------------------------

export interface EncodedMemo {
  /** Raw bytes: PEEL(4) | version(1) | intentId(16) | userMemo(0-13) */
  bytes: Uint8Array;
  /** Lowercase hex, no 0x prefix. */
  hex: string;
  intentId: string;
}

// ---------------------------------------------------------------------------
// Network liveness
// ---------------------------------------------------------------------------

export interface NetworkLivenessResult {
  layer: NetworkLayer;
  alive: boolean;
  latencyMs: number;
  blockHeight?: string;
  checkedAt: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Recipient heuristic
// ---------------------------------------------------------------------------

export interface RecipientHint {
  /** EVM chains where the recipient has non-zero BTC-pegged balance, highest first. */
  activeLayers: Array<"bob" | "rootstock" | "citrea">;
  /** The EVM chain with the highest BTC-pegged balance (best chain to route to). */
  preferredEvm: "bob" | "rootstock" | "citrea" | null;
}

// ---------------------------------------------------------------------------
// Internal — candidate routing
// ---------------------------------------------------------------------------

export interface CandidateRoute {
  sourceLayer: NetworkLayer;
  destinationLayer: NetworkLayer;
  bridge: BridgeName | undefined;
  sourceAsset: string;
  destinationAsset: string;
  /** Sender's balance of the source asset (sats). Used for sender-balance scoring. */
  senderBalanceSats: bigint;
  estimatedFeeSats: bigint;
  estimatedTimeSecs: number;
}

export interface ScoredCandidate extends CandidateRoute {
  score: number;
  scoreBreakdown: {
    senderBalance: number;
    receiverActivity: number;
    feeRate: number;
    settlementTime: number;
  };
}
