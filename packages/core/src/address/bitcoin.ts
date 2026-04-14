import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { Caip2Namespace } from "@peelbtc/types";
import type { DerivedAddress } from "@peelbtc/types";

// ---------------------------------------------------------------------------
// Bitcoin P2WPKH address derivation (BIP-84, native SegWit)
//
// Given a 33-byte compressed secp256k1 public key:
//   1. hash160 = RIPEMD160(SHA256(pubkey))   → 20 bytes (witness program)
//   2. bech32 encode with witness version 0  → bc1q... (mainnet)
//                                            → tb1q... (testnet)
//
// Derivation path: m/84'/0'/0'/0/n (mainnet)
//                  m/84'/1'/0'/0/n (testnet)
// ---------------------------------------------------------------------------

// bech32 charset
const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

// Generator polynomial for bech32 checksum
const BECH32_GENERATOR = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= BECH32_GENERATOR[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const expand: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    expand.push(hrp.charCodeAt(i) >> 5);
  }
  expand.push(0);
  for (let i = 0; i < hrp.length; i++) {
    expand.push(hrp.charCodeAt(i) & 31);
  }
  return expand;
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 31);
  }
  return checksum;
}

/**
 * Convert a byte array to base-32 5-bit groups (used by bech32 witness encoding).
 * Converts from 8-bit groups to 5-bit groups.
 */
function convertBits(
  data: Uint8Array,
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) result.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error("Invalid bit conversion — padding error");
  }

  return result;
}

/**
 * Encode a segwit address using bech32.
 * @param hrp           Human-readable part ("bc" or "tb")
 * @param version       Witness version (0 for P2WPKH/P2WSH)
 * @param program       Witness program bytes (20 bytes for P2WPKH)
 */
function bech32SegwitEncode(
  hrp: string,
  version: number,
  program: Uint8Array,
): string {
  const data = [version].concat(convertBits(program, 8, 5, true));
  const checksum = bech32CreateChecksum(hrp, data);
  let result = hrp + "1";
  for (const d of data.concat(checksum)) {
    result += BECH32_ALPHABET[d];
  }
  return result;
}

/**
 * hash160: SHA256 then RIPEMD160.
 */
function hash160(pubkey: Uint8Array): Uint8Array {
  return ripemd160(sha256(pubkey));
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Derive a Bitcoin P2WPKH (native SegWit, BIP-84) address from a 33-byte
 * compressed secp256k1 public key.
 *
 * @param compressedPubkey  33-byte compressed public key
 * @param testnet           If true, derives a tb1q... testnet address
 * @returns                 DerivedAddress with bech32 P2WPKH address (bc1q... or tb1q...)
 */
export function deriveBitcoinAddress(
  compressedPubkey: Uint8Array,
  testnet = false,
): DerivedAddress {
  if (compressedPubkey.length !== 33) {
    throw new Error(
      `Expected 33-byte compressed public key, got ${compressedPubkey.length} bytes`,
    );
  }
  const hrp = testnet ? "tb" : "bc";
  const witnessProgram = hash160(compressedPubkey);
  return {
    address: bech32SegwitEncode(hrp, 0, witnessProgram),
    layer: "bitcoin",
    namespace: Caip2Namespace.Bip122,
    format: "p2wpkh",
    testnet,
  };
}
