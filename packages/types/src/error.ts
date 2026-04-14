// ---------------------------------------------------------------------------
// PeelError — structured error type for the Peel protocol
// ---------------------------------------------------------------------------

export type PeelErrorCode =
  /** Address string could not be matched to any known network */
  | "UNKNOWN_ADDRESS"
  /** Address is valid on multiple networks (e.g. bare 0x with no hint) */
  | "AMBIGUOUS_ADDRESS"
  /** Target network RPC is unreachable or returning errors */
  | "NETWORK_DOWN"
  /** Network is recognized but not supported by this implementation */
  | "UNSUPPORTED_NETWORK"
  /** Payment intent violates caller-specified constraints (fee, time) */
  | "CONSTRAINTS_UNMET"
  /** Wallet does not hold enough of the required asset */
  | "INSUFFICIENT_BALANCE"
  /** Transaction construction or sighash building failed */
  | "BUILD_FAILED"
  /** Signing operation failed */
  | "SIGN_FAILED"
  /** Broadcast to the network failed */
  | "BROADCAST_FAILED"
  /** Deposit amount is below the bridge's minimum threshold */
  | "BRIDGE_MINIMUM_NOT_MET"
  /** Bitcoin UTXOs are required but were not provided in the intent */
  | "UTXO_REQUIRED"
  /** PaymentIntent failed validation */
  | "INVALID_INTENT";

export class PeelError extends Error {
  readonly code: PeelErrorCode;
  readonly details?: unknown;

  constructor(code: PeelErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "PeelError";
    this.code = code;
    this.details = details;
    // Restore prototype chain in environments that transpile classes
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
