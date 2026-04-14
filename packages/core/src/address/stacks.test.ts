import { describe, it, expect } from "vitest";
import { deriveStacksAddress } from "./stacks.js";
import { publicKeyToAddress } from '@stacks/transactions'

// Compressed public key for secp256k1 generator point (private key = 1).
// This is the standard test vector used across Bitcoin/Stacks tooling.
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

describe("deriveStacksAddress", () => {
  it("derives a mainnet SP address", () => {
    const result = deriveStacksAddress(GENERATOR_POINT_PUBKEY);
    expect(result.address).toMatch(/^SP/);
  });

  it("derives a testnet ST address", () => {
    const result = deriveStacksAddress(GENERATOR_POINT_PUBKEY, true);
    expect(result.address).toMatch(/^ST/);
  });

  it("produces a valid c32check length (41 chars for non-zero hash)", () => {
    const result = deriveStacksAddress(GENERATOR_POINT_PUBKEY);
    // Stacks addresses are 41 chars: 'S' + version + 39 c32 chars
    expect(result.address.length).toBeGreaterThanOrEqual(40);
    expect(result.address.length).toBeLessThanOrEqual(41);
  });

  it("contains only valid c32 characters after the SP/ST prefix", () => {
    const result = deriveStacksAddress(GENERATOR_POINT_PUBKEY);
    // After 'S' prefix, only c32 alphabet chars are valid
    const body = result.address.slice(1); // remove leading 'S'
    expect(body).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it("is deterministic — same pubkey always gives same address", () => {
    const a1 = deriveStacksAddress(GENERATOR_POINT_PUBKEY);
    const a2 = deriveStacksAddress(GENERATOR_POINT_PUBKEY);
    expect(a1.address).toBe(a2.address);
  });

  it("mainnet and testnet addresses differ for the same pubkey", () => {
    const mainnet = deriveStacksAddress(GENERATOR_POINT_PUBKEY);
    const testnet = deriveStacksAddress(GENERATOR_POINT_PUBKEY, true);
    expect(mainnet.address).not.toBe(testnet.address);
  });

  it("different public keys produce different addresses", () => {
    const addr1 = deriveStacksAddress(GENERATOR_POINT_PUBKEY);
    const addr2 = deriveStacksAddress(PUBKEY_2);
    expect(addr1.address).not.toBe(addr2.address);
  });

  it("throws on wrong pubkey length", () => {
    const badKey = new Uint8Array(32); // 32 bytes, not 33
    expect(() => deriveStacksAddress(badKey)).toThrow(
      "Expected 33-byte compressed public key",
    );
  });
  
  it("matches address derivation from @stacks/transactions", () => {
    const result = deriveStacksAddress(GENERATOR_POINT_PUBKEY);
    const address_2 = publicKeyToAddress("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "mainnet")

    expect(result.address).toBe(address_2)
  });
});
