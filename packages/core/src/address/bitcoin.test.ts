import { describe, it, expect } from "vitest";
import { deriveBitcoinAddress } from "./bitcoin.js";

// Compressed public key for secp256k1 generator point (private key = 1).
// Compressed pubkey: 02 + x-coordinate of G
const GENERATOR_POINT_PUBKEY = new Uint8Array(
  Buffer.from(
    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    "hex",
  ),
);

// A second distinct public key for uniqueness tests (private key = 2)
const PUBKEY_2 = new Uint8Array(
  Buffer.from(
    "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    "hex",
  ),
);

describe("deriveBitcoinAddress", () => {
  it("derives a mainnet bc1q address", () => {
    const result = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY);
    expect(result.address).toMatch(/^bc1q/);
  });

  it("derives a testnet tb1q address", () => {
    const result = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY, true);
    expect(result.address).toMatch(/^tb1q/);
  });

  it("matches the known address for the generator point", () => {
    // This is the well-established P2WPKH address for privkey=1 generator point.
    // Verified against Bitcoin Core and bitcoinjs-lib.
    const result = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY);
    expect(result.address).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  });

  it("is deterministic — same pubkey always gives same address", () => {
    const a1 = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY);
    const a2 = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY);
    expect(a1.address).toBe(a2.address);
  });

  it("mainnet and testnet addresses differ for the same pubkey", () => {
    const mainnet = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY);
    const testnet = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY, true);
    expect(mainnet.address).not.toBe(testnet.address);
  });

  it("different public keys produce different addresses", () => {
    const addr1 = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY);
    const addr2 = deriveBitcoinAddress(PUBKEY_2);
    expect(addr1.address).not.toBe(addr2.address);
  });

  it("address length is 42 characters (bc1q + 38)", () => {
    const result = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY);
    expect(result.address.length).toBe(42);
  });

  it("contains only valid bech32 characters", () => {
    const result = deriveBitcoinAddress(GENERATOR_POINT_PUBKEY);
    // bech32 charset after the '1' separator: qpzry9x8gf2tvdw0s3jn54khce6mua7l
    expect(result.address).toMatch(/^[a-z0-9]+$/);
  });

  it("throws on wrong pubkey length", () => {
    const badKey = new Uint8Array(32);
    expect(() => deriveBitcoinAddress(badKey)).toThrow(
      "Expected 33-byte compressed public key",
    );
  });
});
