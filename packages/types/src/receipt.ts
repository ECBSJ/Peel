// ---------------------------------------------------------------------------
// PaymentReceipt — what happened after a payment was broadcast
// ---------------------------------------------------------------------------

export type PaymentStatus =
  /** Transaction was accepted by the network mempool */
  | "broadcast"
  /** Transaction has at least one confirmation */
  | "confirmed"
  /** Transaction failed to broadcast or was rejected */
  | "failed";

/**
 * The result of executing a PaymentIntent.
 * Returned after a signed transaction has been submitted to the network.
 */
export interface PaymentReceipt {
  /** Network the payment was sent on */
  network: string;

  /** Asset that was transferred */
  asset: string;

  /** Transaction id as returned by the network */
  txid: string;

  /** Block explorer URL for this transaction */
  explorerUrl: string;

  /** Normalized recipient address */
  recipient: string;

  /** Amount sent, in satoshis */
  amountSats: bigint;

  /** Fee paid, in satoshis */
  feeSats: bigint;

  /** Unix timestamp (ms) when the transaction was broadcast */
  timestamp: number;

  /** Current status of the transaction */
  status: PaymentStatus;

  /** Hex-encoded signed transaction (useful for debugging / re-broadcast) */
  rawTxHex: string;

  /** Error message if status is "failed" */
  error?: string;
}
