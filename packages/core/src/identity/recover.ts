import { sha256 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { DerivedAddress } from "@peelbtc/types";
import {
  deriveBitcoinAddress,
  deriveStacksAddress,
  deriveEvmAddress,
} from "../address/index.js";

// ---------------------------------------------------------------------------
// BRID public key recovery via Bitcoin message signing
//
// Wallets that cannot expose a raw public key directly can instead sign the
// BRID Identity Proof message. The secp256k1 signature reveals the public key
// via elliptic curve public key recovery — no private key exposure required.
//
// Signing format: standard Bitcoin message signature
//   65 bytes  = 1 header byte + 32 r + 32 s, transmitted as base64
//   header    = 27 + recoveryId  (uncompressed key, values 27–30)
//   header    = 31 + recoveryId  (compressed key,   values 31–34)
//   recoveryId is exposed directly via @noble/curves Signature.recovery
//
// Message hashing: double-SHA256 with Bitcoin magic prefix
//   SHA256(SHA256( \x18"Bitcoin Signed Message:\n" || varint(len) || message ))
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Complete BRID identity map: root address, public key, and all layer addresses. */
export interface BridIdentityMap {
  /** Bitcoin P2WPKH root address (bc1q... or tb1q...) */
  root: string;
  /** Hex-encoded 33-byte compressed secp256k1 public key */
  publicKey: string;
  /** Derived layer addresses — first entry is always the Bitcoin root */
  derived: DerivedAddress[];
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Build the canonical BRID Identity Proof message for a given Bitcoin address.
 * This is the exact string the wallet must sign to reveal its public key.
 *
 * The public key is never embedded in the message — it is revealed implicitly
 * through the act of signing, and recovered via `recoverPublicKey`.
 */
export function buildIdentityProofMessage(address: string): string {
  return `BRID Identity Proof:\nBitcoin Address: ${address}`;
}

/**
 * Hash a message using Bitcoin's message signing format.
 *
 * SHA256(SHA256( \x18"Bitcoin Signed Message:\n" || varint(len(msg)) || msg ))
 *
 * Exposed for wallets that need to produce the hash before calling their
 * signing primitive directly.
 */
export function hashBitcoinMessage(message: string): Uint8Array {
  const PREFIX = "Bitcoin Signed Message:\n";
  const prefixBytes = new TextEncoder().encode(PREFIX); // always 24 bytes
  const messageBytes = new TextEncoder().encode(message);

  if (messageBytes.length >= 253) {
    // single-byte varint only covers 0–252
    throw new Error(
      "Message too long — BRID Identity Proof messages must be under 253 bytes",
    );
  }

  // Wire format: varint(len(prefix)) || prefix || varint(len(message)) || message
  const payload = new Uint8Array([
    prefixBytes.length, // 24 = 0x18
    ...prefixBytes,
    messageBytes.length,
    ...messageBytes,
  ]);

  return sha256(sha256(payload));
}

/**
 * Recover the compressed secp256k1 public key from a Bitcoin message signature.
 *
 * The wallet must have signed the canonical BRID Identity Proof message
 * (`buildIdentityProofMessage(address)`) using its Bitcoin P2WPKH key.
 *
 * The recovered key is verified against the claimed address before being
 * returned — a mismatched signature or address will throw.
 *
 * @param address          The claimed Bitcoin P2WPKH address (bc1q... or tb1q...)
 * @param message          The message that was signed
 * @param signatureBase64  65-byte Bitcoin message signature, base64-encoded
 * @returns                33-byte compressed secp256k1 public key
 */
export function recoverPublicKey(
  address: string,
  message: string,
  signatureBase64: string,
): Uint8Array {
  // Decode base64 → 65 bytes
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Invalid signature: base64 decoding failed");
  }

  if (sigBytes.length !== 65) {
    throw new Error(
      `Invalid signature: expected 65 bytes, got ${sigBytes.length}`,
    );
  }
  
  // Hash the message using Bitcoin's message hashing format
  const msgHash = hashBitcoinMessage(message);
  
  let recoveredPubkey: Uint8Array;
  try {
    recoveredPubkey = secp256k1.recoverPublicKey(sigBytes, msgHash);
  } catch (err) {
    throw new Error(
      `Public key recovery failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Verify: derived address must match the claimed address
  const isTestnet = address.startsWith("tb1");
  const derived = deriveBitcoinAddress(recoveredPubkey, isTestnet);
  
  if (derived.address !== address) {
    throw new Error(
      `Signature verification failed: recovered address ${derived.address} does not match claimed ${address}`,
    );
  }

  return recoveredPubkey;
}

/**
 * Recover the public key from a Bitcoin message signature and derive a
 * complete BRID identity map across all supported layers.
 *
 * Convenience wrapper around `recoverPublicKey` + all three `derive*Address`
 * functions. Use this when you want the full identity map from a wallet that
 * can sign but cannot directly expose its public key.
 *
 * @param address          Bitcoin P2WPKH address (bc1q... or tb1q...)
 * @param message          The signed message (use `buildIdentityProofMessage`)
 * @param signatureBase64  65-byte Bitcoin message signature, base64-encoded
 * @returns                Full BRID identity map
 */
export function buildBridIdentityMap(
  address: string,
  message: string,
  signatureBase64: string,
): BridIdentityMap {
  const isTestnet = address.startsWith("tb1");
  const pubkey = recoverPublicKey(address, message, signatureBase64);
  const pubkeyHex = Array.from(pubkey, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

  return {
    root: address,
    publicKey: pubkeyHex,
    derived: [
      deriveBitcoinAddress(pubkey, isTestnet),
      deriveStacksAddress(pubkey, isTestnet),
      deriveEvmAddress(pubkey, isTestnet),
    ],
  };
}
