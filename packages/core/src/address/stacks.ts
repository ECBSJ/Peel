import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { Caip2Namespace } from "@peelbtc/types";
import type { DerivedAddress } from "@peelbtc/types";

// ---------------------------------------------------------------------------
// Stacks address derivation
//
// All Stacks addresses derive from the same secp256k1 keypair as Bitcoin.
// Given a 33-byte compressed public key:
//   1. hash160 = RIPEMD160(SHA256(pubkey))   → 20 bytes
//   2. c32checkEncode(version, hash160)       → SP... or ST...
//
// Version bytes:
//   22 (0x16) → mainnet P2PKH → "SP" prefix
//   26 (0x1a) → testnet P2PKH → "ST" prefix
// ---------------------------------------------------------------------------

/** c32 alphabet — base-32 encoding used by Stacks (no I, L, O, U) */
const C32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const MAINNET_P2PKH = 22;
const TESTNET_P2PKH = 26;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encode a byte array as a c32 string.
 * Treats the input as a big-endian unsigned integer encoded in base 32.
 * Leading zero bytes are preserved as '0' characters.
 */
function c32encode(data: Uint8Array): string {
  let leadingZeroBytes = 0;
  for (let i = 0; i < data.length && data[i] === 0; i++) {
    leadingZeroBytes++;
  }

  let result = "";
  let num = BigInt("0x" + bytesToHex(data));

  while (num >= 32n) {
    result = C32_ALPHABET[Number(num % 32n)] + result;
    num = num / 32n;
  }
  result = C32_ALPHABET[Number(num)] + result;

  return "0".repeat(leadingZeroBytes) + result;
}

/**
 * c32check encode: version byte + payload → checksummed c32 string.
 * Produces the body of a Stacks address (without the leading 'S').
 */
function c32checkEncode(version: number, payload: Uint8Array): string {
  // Checksum: double SHA256 of (version || payload)
  const checksumInput = new Uint8Array(1 + payload.length);
  checksumInput[0] = version;
  checksumInput.set(payload, 1);
  const checksum = sha256(sha256(checksumInput)).slice(0, 4);

  // Encoded body: payload || checksum
  const body = new Uint8Array(payload.length + checksum.length);
  body.set(payload);
  body.set(checksum, payload.length);

  const versionChar = C32_ALPHABET[version & 0x1f];
  return `S${versionChar}${c32encode(body)}`;
}

/**
 * hash160: SHA256 then RIPEMD160.
 * This is the same primitive used by Bitcoin P2PKH/P2WPKH.
 */
function hash160(pubkey: Uint8Array): Uint8Array {
  return ripemd160(sha256(pubkey));
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Derive a Stacks address from a 33-byte compressed secp256k1 public key.
 *
 * @param compressedPubkey  33-byte compressed public key
 * @param testnet           If true, derives an ST... testnet address
 * @returns                 DerivedAddress with c32check address (SP... or ST...)
 */
export function deriveStacksAddress(
  compressedPubkey: Uint8Array,
  testnet = false,
): DerivedAddress {
  if (compressedPubkey.length !== 33) {
    throw new Error(
      `Expected 33-byte compressed public key, got ${compressedPubkey.length} bytes`,
    );
  }
  const version = testnet ? TESTNET_P2PKH : MAINNET_P2PKH;
  const h160 = hash160(compressedPubkey);
  return {
    address: c32checkEncode(version, h160),
    layer: "stacks",
    namespace: Caip2Namespace.Stacks,
    format: "c32check",
    testnet,
  };
}
