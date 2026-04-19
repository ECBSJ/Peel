import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  buildIdentityProofMessage,
  hashBitcoinMessage,
  recoverPublicKey,
  buildBridIdentityMap,
} from "./recover.js";


// ---------------------------------------------------------------------------
// Test vectors — privkey = 1 (generator point)
// ---------------------------------------------------------------------------

const PRIVKEY_1_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";
const PUBKEY_1_HEX =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const ADDRESS_1 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const EVM_ADDRESS_1 = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

/**
 * Sign a message using Bitcoin's message signing format.
 * Produces the same base64 signature a Bitcoin wallet would produce.
 * Used only in tests — in production the wallet does this signing step.
 */
function signBitcoinMessage(message: string, privkeyHex: string): string {
  const privkey = hexToBytes(privkeyHex);
  const msgHash = hashBitcoinMessage(message);
  const sig65 = secp256k1.sign(msgHash, privkey, { prehash: false, format: 'recovered' }); // 65-byte: recovery (v) || r || s
  const sigInstance = secp256k1.Signature.fromBytes(sig65, 'recovered');

  const base64 = btoa(
    Array.from(sig65, b => String.fromCharCode(b)).join("")
  );

  return base64
}

// ---------------------------------------------------------------------------
// buildIdentityProofMessage
// ---------------------------------------------------------------------------

describe("buildIdentityProofMessage", () => {
  it("builds the canonical BRID message string", () => {
    const msg = buildIdentityProofMessage(ADDRESS_1);
    expect(msg).toBe(`BRID Identity Proof:\nBitcoin Address: ${ADDRESS_1}`);
  });

  it("does not include a Public Key field", () => {
    const msg = buildIdentityProofMessage(ADDRESS_1);
    expect(msg).not.toContain("Public Key");
  });
});

// ---------------------------------------------------------------------------
// hashBitcoinMessage
// ---------------------------------------------------------------------------

describe("hashBitcoinMessage", () => {
  it("returns a 32-byte Uint8Array", () => {
    const hash = hashBitcoinMessage("hello");
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it("produces different hashes for different messages", () => {
    const h1 = hashBitcoinMessage("message one");
    const h2 = hashBitcoinMessage("message two");
    expect(h1).not.toEqual(h2);
  });

  it("is deterministic", () => {
    const h1 = hashBitcoinMessage("same message");
    const h2 = hashBitcoinMessage("same message");
    expect(h1).toEqual(h2);
  });
});

// ---------------------------------------------------------------------------
// recoverPublicKey
// ---------------------------------------------------------------------------

describe("recoverPublicKey", () => {
  it("recovers public key from an OWS signature", () => {
    const owsAddress = "bc1qrk3txtstlpdffr3lss4nq3x0rfs7nhcqqpr33k"
    let owsPubKey = "0365b706e3ab5ece1c73f6a7a21626871b2c43919ff87599abe887a29343484524"
    let owsPrivKey = "Kz6YweubWZNr3BB6CyRPiN5QNZPL19PpaEqhUGPspBz2JbeEf5TS"

    const message = "bitcoin";
    let msgHash = "9206313371d3609df9d62b0e24026d6ac518c128f74640b4189c7f3aeb280c09"

    // OWS returns signature in r || s || v format
    let owsSignatureObj = {
        "recovery_id": 1,
        "signature": "3a0a1f7a28c7b0c28111f4eff1c18b76d8cf33ffdf996b6ca402119e11580f5d3ed721d51537b486692648823129c0545b3a90069e2240d6d640effb7fb6c3fd01"
    }
    let sigBytes = hexToBytes(owsSignatureObj.signature)
    let adjustedSigBytes = new Uint8Array([sigBytes[sigBytes.length - 1], ...sigBytes.subarray(0, -1)])
    let owsSig = Buffer.from(adjustedSigBytes).toString('base64')

    let verified = secp256k1.verify(adjustedSigBytes, hexToBytes(msgHash), hexToBytes(owsPubKey), { prehash: false, format: 'recovered' })
    let recovered = recoverPublicKey(owsAddress, message, owsSig)
    expect(verified).toBeTruthy()
    expect(Buffer.from(recovered).toString('hex')).toBe(owsPubKey)
  })

  it("recovers the correct compressed public key", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const recovered = recoverPublicKey(ADDRESS_1, message, sig);
    const hex = Array.from(recovered, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    expect(hex).toBe(PUBKEY_1_HEX);
  });

  it("returns a 33-byte compressed key (02 or 03 prefix)", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const recovered = recoverPublicKey(ADDRESS_1, message, sig);
    expect(recovered).toHaveLength(33);
    expect([0x02, 0x03]).toContain(recovered[0]);
  });

  it("throws if the recovered address does not match the claimed address", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    // Valid P2WPKH address, but not ADDRESS_1's key
    const wrongAddress = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    expect(() => recoverPublicKey(wrongAddress, message, sig)).toThrow(
      "does not match",
    );
  });

  it("throws on wrong signature length", () => {
    const shortSig = btoa("tooshort");
    expect(() =>
      recoverPublicKey(ADDRESS_1, "msg", shortSig),
    ).toThrow("expected 65 bytes");
  });

  it("throws on invalid signature recovery byte", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    // Tamper with the recovery byte — noble format uses 0 or 1; anything else is invalid
    const raw = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    raw[0] = 0x02; // invalid recovery byte
    const tampered = btoa(String.fromCharCode(...raw));
    expect(() =>
      recoverPublicKey(ADDRESS_1, message, tampered),
    ).toThrow();
  });

  it("is deterministic — same inputs always produce the same pubkey", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const r1 = recoverPublicKey(ADDRESS_1, message, sig);
    const r2 = recoverPublicKey(ADDRESS_1, message, sig);
    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// buildBridIdentityMap
// ---------------------------------------------------------------------------

describe("buildBridIdentityMap", () => {
  it("returns a map with root matching the provided address", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const map = buildBridIdentityMap(ADDRESS_1, message, sig);
    expect(map.root).toBe(ADDRESS_1);
  });

  it("includes the correct compressed public key hex", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const map = buildBridIdentityMap(ADDRESS_1, message, sig);
    expect(map.publicKey).toBe(PUBKEY_1_HEX);
  });

  it("returns exactly 5 derived addresses (bitcoin, stacks, bob, rootstock, citrea)", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const map = buildBridIdentityMap(ADDRESS_1, message, sig);
    expect(map.derived).toHaveLength(5);
    expect(map.derived[0].layer).toBe("bitcoin");
    expect(map.derived[1].layer).toBe("stacks");
    expect(map.derived[2].layer).toBe("bob");
    expect(map.derived[3].layer).toBe("rootstock");
    expect(map.derived[4].layer).toBe("citrea");
  });

  it("bitcoin derived address is the root address", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const map = buildBridIdentityMap(ADDRESS_1, message, sig);
    expect(map.derived[0].address).toBe(ADDRESS_1);
  });

  it("evm derived addresses (bob, rootstock, citrea) all match the same known test vector", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const map = buildBridIdentityMap(ADDRESS_1, message, sig);
    expect(map.derived[2].address).toBe(EVM_ADDRESS_1); // bob
    expect(map.derived[3].address).toBe(EVM_ADDRESS_1); // rootstock
    expect(map.derived[4].address).toBe(EVM_ADDRESS_1); // citrea
  });

  it("all derived addresses are mainnet (testnet: false)", () => {
    const message = buildIdentityProofMessage(ADDRESS_1);
    const sig = signBitcoinMessage(message, PRIVKEY_1_HEX);
    const map = buildBridIdentityMap(ADDRESS_1, message, sig);
    for (const derived of map.derived) {
      expect(derived.testnet).toBe(false);
    }
  });
});
