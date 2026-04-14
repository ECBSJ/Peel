import type { PaymentIntent } from "./intent.js";
import type { PaymentReceipt } from "./receipt.js";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Result of parsing an address string.
 * Returned by NetworkAdapter.parseAddress().
 */
export interface AddressParseResult {
  /** Network id this address belongs to */
  network: string;
  /** Address encoding format, e.g. "bech32", "c32check", "evm-hex", "p2pkh" */
  format: string;
  /** Whether this is a testnet address */
  testnet: boolean;
  /** Normalized address string */
  address: string;
}

/**
 * A secp256k1 ECDSA signature.
 * All Peel signing operations produce this shape — regardless of network.
 */
export interface Signature {
  /** Raw 64-byte signature: 32 bytes r + 32 bytes s */
  bytes: Uint8Array;
  /** Recovery ID (0 or 1). Required by some chains for address recovery. */
  recoveryId?: number;
}

/**
 * The output of NetworkAdapter.buildSighash().
 * Contains the 32-byte hash to sign and the in-progress unsigned transaction
 * bytes needed to assemble the final signed transaction after signing.
 */
export interface SighashResult {
  /** 32-byte hash to be signed by the SignerAdapter */
  hash: Uint8Array;
  /**
   * Serialized unsigned transaction — passed back to assembleSignedTx()
   * after signing. Format is network-specific.
   */
  unsignedTx: Uint8Array;
  /** Network that produced this sighash */
  network: string;
  /** Human-readable description of this transaction */
  description: string;
}

/**
 * Options passed to the SignerAdapter.
 * Intentionally open-ended — each adapter reads only the fields it needs.
 */
export interface SignOptions {
  /** HD wallet derivation index (default: 0) */
  index?: number;
  /** Network context — helps adapters select the right key derivation path */
  network?: string;
  /** Any adapter-specific options (e.g. walletName for OWS, topic for WC) */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// NetworkAdapter — contract each chain implements to plug into Peel
// ---------------------------------------------------------------------------

export interface NetworkAdapter {
  /** Unique network identifier matching NetworkConfig.id */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;

  /**
   * Try to parse an address string.
   * Returns null if this network does not recognize the address format.
   * Must never throw — return null on any parse failure.
   */
  parseAddress(address: string, networkHint?: string): AddressParseResult | null;

  /**
   * Build the sighash for a payment.
   * @param intent    The validated payment intent
   * @param senderPubkey  33-byte compressed secp256k1 public key of the sender.
   *                      Used to derive the sender address and build the tx.
   * @returns SighashResult containing the 32-byte hash and unsigned tx bytes
   */
  buildSighash(
    intent: PaymentIntent,
    senderPubkey: Uint8Array,
  ): Promise<SighashResult>;

  /**
   * Assemble a complete signed transaction from the sighash result and signature.
   * @returns Hex-encoded signed transaction ready for broadcast
   */
  assembleSignedTx(sighash: SighashResult, signature: Signature): string;

  /**
   * Broadcast a signed transaction to the network.
   * @param signedTxHex  Hex-encoded signed transaction
   * @returns PaymentReceipt with txid and explorer URL
   */
  broadcast(signedTxHex: string, intent: PaymentIntent): Promise<PaymentReceipt>;

  /**
   * Estimate the fee for a payment intent.
   * @returns Fee estimate in satoshis
   */
  estimateFee(intent: PaymentIntent): Promise<bigint>;
}

// ---------------------------------------------------------------------------
// BridgeAdapter — for acquiring bridged BTC on an L2 from BTC L1
// ---------------------------------------------------------------------------

export interface BridgeDepositResult {
  /** Address or contract to send the BTC deposit to */
  depositAddress: string;
  /** Pre-built unsigned deposit transaction hex, if the bridge provides one */
  depositTxHex?: string;
  /** Estimated time for the bridged asset to appear on the target network */
  estimatedMintTimeSecs: number;
  /** Tracking id for polling status */
  trackingId?: string;
  /** Human-readable description */
  description: string;
}

export type BridgeStatus =
  | "pending"
  | "confirming"
  | "minting"
  | "completed"
  | "failed";

export interface BridgeStatusResult {
  status: BridgeStatus;
  /** BTC L1 deposit txid */
  sourceTxid?: string;
  /** L2 mint txid */
  destinationTxid?: string;
  /** Number of BTC confirmations so far */
  confirmations?: number;
  /** Human-readable status message */
  message: string;
}

export interface BridgeAdapter {
  /** Unique bridge identifier, e.g. "sbtc", "tbtc" */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Network where the bridged asset is minted */
  readonly targetNetwork: string;
  /** Symbol of the asset minted on the target network */
  readonly mintedAsset: string;
  /** Minimum deposit in satoshis */
  readonly minDepositSats: bigint;

  /** Initiate a bridge deposit from BTC L1 to the target network */
  initiateDeposit(
    amountSats: bigint,
    recipientAddress: string,
  ): Promise<BridgeDepositResult>;

  /** Poll the status of a bridge deposit by tracking id */
  pollStatus(trackingId: string): Promise<BridgeStatusResult>;

  /** Estimated mint time in seconds */
  estimateMintTime(): number;
}

// ---------------------------------------------------------------------------
// SignerAdapter — pluggable signing (OWS, MetaMask, WalletConnect, etc.)
// ---------------------------------------------------------------------------

export interface SignerAdapter {
  /** Adapter identifier, e.g. "ows", "metamask", "walletconnect" */
  readonly name: string;

  /**
   * Returns true if this adapter can sign for the given network.
   * Used by the router to select the right adapter.
   */
  canSign(network: string): boolean;

  /**
   * Sign a 32-byte hash using secp256k1 ECDSA.
   * This is the only cryptographic primitive Peel uses — all chains
   * reduce their signing to this operation.
   */
  sign(hash: Uint8Array, options: SignOptions): Promise<Signature>;

  /**
   * Return the 33-byte compressed secp256k1 public key for this signer.
   * Used by transaction builders to derive addresses and construct transactions.
   */
  getPublicKey(options: SignOptions): Promise<Uint8Array>;
}
