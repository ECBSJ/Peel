// ---------------------------------------------------------------------------
// PaymentIntent — what a user or agent wants to do
// ---------------------------------------------------------------------------

/**
 * A single unspent transaction output. Callers provide their own UTXOs —
 * Peel never fetches or stores them. Required for Bitcoin L1 transfers.
 */
export interface Utxo {
  txid: string;
  vout: number;
  /** Value in satoshis */
  value: bigint;
  /** Hex-encoded scriptPubKey */
  scriptPubKey: string;
}

/**
 * Optional caller-specified constraints on the payment.
 * The router will reject routes that cannot satisfy these.
 */
export interface PaymentConstraints {
  /** Maximum acceptable fee in satoshis */
  maxFeeSats?: bigint;
  /** Maximum acceptable confirmation time in seconds */
  maxConfirmTimeSecs?: number;
  /** If true, do not use any bridge — only direct transfers */
  noBridge?: boolean;
  /** Preferred network id — router will try this network first */
  preferredNetwork?: string;
}

/**
 * The primary input to the Peel routing engine.
 * Describe what you want to pay — Peel figures out how.
 *
 * Amounts are always in satoshis (bigint) to avoid floating point errors.
 */
export interface PaymentIntent {
  /** Protocol version — always "1.0" for now */
  version: "1.0";

  /** Recipient address in any supported format */
  recipient: string;

  /** Amount to send, in satoshis */
  amountSats: bigint;

  /** Optional human-readable memo / payment reference */
  memo?: string;

  /**
   * Network hint to disambiguate addresses that are valid on multiple chains.
   * Required for bare 0x addresses (e.g. "bob", "rootstock", "citrea").
   * Ignored when the address format is already unambiguous (SP..., bc1...).
   */
  networkHint?: string;

  /** Optional caller-specified constraints */
  constraints?: PaymentConstraints;

  // -------------------------------------------------------------------------
  // Chain-specific context — callers provide these; Peel does not fetch them
  // -------------------------------------------------------------------------

  /**
   * UTXOs to spend for Bitcoin L1 payments.
   * Required when routing to Bitcoin L1.
   * Wallet is responsible for selecting appropriate UTXOs.
   */
  utxos?: Utxo[];

  /**
   * Change address for Bitcoin L1 payments.
   * If omitted, the sender address (derived from public key) is used.
   */
  changeAddress?: string;

  /**
   * EVM transaction nonce.
   * Required when routing to EVM-compatible networks (BOB, Rootstock, Citrea).
   * Wallet or caller is responsible for fetching the current nonce.
   */
  nonce?: number;
}
