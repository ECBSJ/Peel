// ---------------------------------------------------------------------------
// RouteQuote — the router's decision for a given PaymentIntent
// ---------------------------------------------------------------------------

/**
 * The routing engine's response to a PaymentIntent.
 * Represents a complete routing decision before any signing or broadcasting.
 *
 * Callers can inspect the quote before executing — this is the "dry run" step.
 */
export interface RouteQuote {
  /** Target network id (e.g. "bitcoin", "stacks", "bob") */
  network: string;

  /** Asset to transfer (e.g. "BTC", "sBTC", "tBTC", "cBTC", "rBTC") */
  asset: string;

  /** Normalized recipient address on the target network */
  recipient: string;

  /** Amount to transfer, in satoshis */
  amountSats: bigint;

  /** Estimated fee, in satoshis */
  estimatedFeeSats: bigint;

  /** Estimated confirmation time in seconds */
  estimatedConfirmTimeSecs: number;

  /** Whether a bridge deposit is required to acquire the asset */
  bridgeRequired: boolean;

  /** Bridge adapter id if bridging is required, e.g. "sbtc", "tbtc" */
  bridgeAdapterId?: string;

  /**
   * One-sentence human-readable explanation of why this route was chosen.
   * Always populated — agents must surface this to users before executing.
   */
  reason: string;

  /**
   * Full human-readable summary of the payment.
   * e.g. "Send 100,000 sats worth of sBTC to SP2J6... on Stacks"
   */
  summary: string;

  /** Unix timestamp (ms) after which this quote should be re-fetched */
  expiresAt: number;
}
