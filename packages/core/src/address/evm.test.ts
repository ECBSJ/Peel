import { describe, it, expect } from "vitest";
import { deriveEvmAddress } from "./evm.js";

// Compressed public key for secp256k1 generator point (private key = 1).
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

describe("deriveEvmAddress", () => {
  it("derives a 0x-prefixed address", () => {
    const result = deriveEvmAddress(GENERATOR_POINT_PUBKEY);
    expect(result.address).toMatch(/^0x/);
  });

  it("matches the known EVM address for the generator point", () => {
    // Well-established test vector: privkey=1 → this EIP-55 checksummed address.
    // Verified against ethers.js and viem.
    const result = deriveEvmAddress(GENERATOR_POINT_PUBKEY);
    expect(result.address).toBe("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
  });

  it("address is 42 characters (0x + 40 hex)", () => {
    const result = deriveEvmAddress(GENERATOR_POINT_PUBKEY);
    expect(result.address.length).toBe(42);
  });

  it("address contains only valid hex characters after 0x", () => {
    const result = deriveEvmAddress(GENERATOR_POINT_PUBKEY);
    expect(result.address.slice(2)).toMatch(/^[0-9a-fA-F]{40}$/);
  });

  it("is deterministic — same pubkey always gives same address", () => {
    const a1 = deriveEvmAddress(GENERATOR_POINT_PUBKEY);
    const a2 = deriveEvmAddress(GENERATOR_POINT_PUBKEY);
    expect(a1.address).toBe(a2.address);
  });

  it("different public keys produce different addresses", () => {
    const addr1 = deriveEvmAddress(GENERATOR_POINT_PUBKEY);
    const addr2 = deriveEvmAddress(PUBKEY_2);
    expect(addr1.address).not.toBe(addr2.address);
  });

  it("testnet flag is carried through to the result", () => {
    const result = deriveEvmAddress(GENERATOR_POINT_PUBKEY, true);
    expect(result.testnet).toBe(true);
  });

  it("mainnet and testnet produce the same address (EVM address is chain-agnostic)", () => {
    const mainnet = deriveEvmAddress(GENERATOR_POINT_PUBKEY, false);
    const testnet = deriveEvmAddress(GENERATOR_POINT_PUBKEY, true);
    expect(mainnet.address).toBe(testnet.address);
  });

  it("layer is 'evm' and format is 'eip55'", () => {
    const result = deriveEvmAddress(GENERATOR_POINT_PUBKEY);
    expect(result.layer).toBe("evm");
    expect(result.format).toBe("eip55");
  });

  it("throws on wrong pubkey length", () => {
    const badKey = new Uint8Array(32);
    expect(() => deriveEvmAddress(badKey)).toThrow(
      "Expected 33-byte compressed public key",
    );
  });
});
