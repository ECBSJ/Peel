import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { Caip2Namespace } from "@peelbtc/types";
import type { DerivedAddress } from "@peelbtc/types";

// ---------------------------------------------------------------------------
// EVM address derivation (EIP-55 checksum format)
//
// Used for all EVM-compatible Bitcoin L2s: BOB, Rootstock, Citrea.
//
// Given a 33-byte compressed secp256k1 public key:
//   1. Decompress pubkey → 65-byte uncompressed (04 || x || y)
//   2. Strip the 04 prefix → 64 raw bytes
//   3. keccak256(64 bytes) → 32 bytes
//   4. Take the last 20 bytes → address bytes
//   5. Hex-encode and apply EIP-55 checksum casing
// ---------------------------------------------------------------------------

/**
 * Apply EIP-55 checksum casing to a 40-char lowercase hex address.
 * For each character at position i: if nibble i of keccak256(address) >= 8, uppercase.
 */
function toChecksumAddress(lowerHex: string): string {
  const hash = keccak_256(new TextEncoder().encode(lowerHex));
  let result = "0x";
  for (let i = 0; i < 40; i++) {
    const byte = hash[i >> 1];
    const nibble = i % 2 === 0 ? (byte >> 4) & 0xf : byte & 0xf;
    result += nibble >= 8 ? lowerHex[i].toUpperCase() : lowerHex[i];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Derive an EVM address from a 33-byte compressed secp256k1 public key.
 *
 * The same address is valid on all EVM-compatible Bitcoin L2s (BOB, Rootstock,
 * Citrea). The address is returned in EIP-55 checksum format.
 *
 * @param compressedPubkey  33-byte compressed public key
 * @param testnet           Carried through to the result; does not change the address
 * @returns                 DerivedAddress with EIP-55 checksummed address (0x...)
 */
export function deriveEvmAddress(
  compressedPubkey: Uint8Array,
  testnet = false,
): DerivedAddress {
  if (compressedPubkey.length !== 33) {
    throw new Error(
      `Expected 33-byte compressed public key, got ${compressedPubkey.length} bytes`,
    );
  }

  // Decompress → 65-byte uncompressed (04 || x || y), strip 04 prefix → 64 bytes
  const pubkeyHex = Array.from(compressedPubkey, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const uncompressed = secp256k1.Point.fromHex(pubkeyHex).toBytes(false);

  // keccak256 of 64 raw pubkey bytes, take last 20 bytes as address
  const hash = keccak_256(uncompressed.slice(1));
  const lowerHex = Array.from(hash.slice(12), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

  return {
    address: toChecksumAddress(lowerHex),
    layer: "evm",
    namespace: Caip2Namespace.Eip155,
    format: "eip55",
    testnet,
  };
}
