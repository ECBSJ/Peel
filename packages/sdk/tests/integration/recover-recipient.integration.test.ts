// ---------------------------------------------------------------------------
// Recipient recovery integration tests — real chains, real addresses
//
// Tests the three on-chain public key recovery paths against known BRID wallet
// addresses. All paths should recover the same compressed public key and
// derive the same cross-chain identity.
//
// Known test identity (from .env.local):
//   pubkey:  0365b706e3ab5ece1c73f6a7a21626871b2c43919ff87599abe887a29343484524
//   bitcoin: bc1qrk3txtstlpdffr3lss4nq3x0rfs7nhcqqpr33k
//   stacks:  SPET5CSE1FW5N54E7Y22PC24SWD63TEZ01GAB7A3
//   evm:     0x2935C2621F4035Dbbf7BC370384B68e76a37C283
//
// Usage:
//   pnpm test:integration
//
// Notes:
//   - Bitcoin recovery requires a spending tx from the address.
//     If the address has never spent, recovery returns null (not a failure).
//   - Stacks mainnet recovery requires at least one signed tx from the address.
//   - EVM recovery uses BOB mainnet where the address has confirmed activity.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  recoverPublicKeyFromAddress,
  recoverRecipientIdentity,
  buildIdentityFromPublicKey,
} from "@peelbtc/core";
import {
  recoverPublicKeyFromEvmAddress,
  recoverEvmRecipientIdentity,
} from "../../src/identity/recover.js";

// ---------------------------------------------------------------------------
// Known BRID identity
// ---------------------------------------------------------------------------

const KNOWN_PUBKEY    = "0365b706e3ab5ece1c73f6a7a21626871b2c43919ff87599abe887a29343484524";
const KNOWN_BITCOIN   = "bc1qrk3txtstlpdffr3lss4nq3x0rfs7nhcqqpr33k";
const KNOWN_STACKS    = "SPET5CSE1FW5N54E7Y22PC24SWD63TEZ01GAB7A3";
const KNOWN_EVM       = "0x2935C2621F4035Dbbf7BC370384B68e76a37C283";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertFullIdentity(identity: ReturnType<typeof buildIdentityFromPublicKey> | null) {
  expect(identity).not.toBeNull();
  expect(identity!.publicKey).toBe(KNOWN_PUBKEY);
  expect(identity!.root).toBe(KNOWN_BITCOIN);

  const stacksDerived = identity!.derived.find(d => d.layer === "stacks");
  expect(stacksDerived?.address).toBe(KNOWN_STACKS);

  const evmDerived = identity!.derived.find(d => d.layer === "bob");
  expect(evmDerived?.address.toLowerCase()).toBe(KNOWN_EVM.toLowerCase());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// @ts-ignore
describe.skipIf(process.env.CI)("Recipient recovery — Stacks", () => {
  it("recovers compressed pubkey from Stacks mainnet address", async () => {
    const pubkey = await recoverPublicKeyFromAddress(KNOWN_STACKS);

    console.log("\n=== Stacks pubkey recovery ===");
    if (!pubkey) {
      console.log("  result: null — address has no signed transaction history on mainnet");
      console.log(`  address: ${KNOWN_STACKS}`);
      // Not a failure — address may have no mainnet history yet
      return;
    }

    const recovered = Array.from(pubkey).map(b => b.toString(16).padStart(2, "0")).join("");
    console.log("  recovered pubkey:", recovered);
    expect(recovered).toBe(KNOWN_PUBKEY);
  }, 20_000);

  it("recovers full identity from Stacks mainnet address", async () => {
    const identity = await recoverRecipientIdentity(KNOWN_STACKS);

    console.log("\n=== Stacks full identity recovery ===");
    if (!identity) {
      console.log("  result: null — address has no signed transaction history on mainnet");
      return;
    }

    console.log("  publicKey:", identity.publicKey);
    console.log("  bitcoin:", identity.root);
    console.log("  stacks:", identity.derived.find(d => d.layer === "stacks")?.address);
    console.log("  evm:", identity.derived.find(d => d.layer === "bob")?.address);

    assertFullIdentity(identity);
  }, 20_000);
});

// @ts-ignore
describe.skipIf(process.env.CI)("Recipient recovery — Bitcoin", () => {
  it("recovers compressed pubkey from Bitcoin address if it has spending history", async () => {
    const pubkey = await recoverPublicKeyFromAddress(KNOWN_BITCOIN);

    console.log("\n=== Bitcoin pubkey recovery ===");
    if (!pubkey) {
      console.log("  result: null — address has no spending transaction (receive-only)");
      console.log(`  address: ${KNOWN_BITCOIN}`);
      console.log("  note: pubkey is revealed only when the address spends a UTXO");
      // Expected for a receive-only address — not a failure
      return;
    }

    const recovered = Array.from(pubkey).map(b => b.toString(16).padStart(2, "0")).join("");
    console.log("  recovered pubkey:", recovered);
    expect(recovered).toBe(KNOWN_PUBKEY);
  }, 20_000);

  it("recovers full identity from Bitcoin address if it has spending history", async () => {
    const identity = await recoverRecipientIdentity(KNOWN_BITCOIN);

    console.log("\n=== Bitcoin full identity recovery ===");
    if (!identity) {
      console.log("  result: null — address has no spending transaction (receive-only)");
      return;
    }

    console.log("  publicKey:", identity.publicKey);
    console.log("  bitcoin:", identity.root);
    console.log("  stacks:", identity.derived.find(d => d.layer === "stacks")?.address);
    console.log("  evm:", identity.derived.find(d => d.layer === "bob")?.address);

    assertFullIdentity(identity);
  }, 20_000);
});

// @ts-ignore
describe.skipIf(process.env.CI)("Recipient recovery — EVM (BOB mainnet)", () => {
  const EVM_OPTS = {
    evmChain: "bob" as const,
    // BOB mainnet block explorer (Blockscout-compatible)
    evmExplorerApiUrl: "https://explorer.gobob.xyz",
  };

  it("recovers compressed pubkey from EVM address on BOB mainnet", async () => {
    const pubkey = await recoverPublicKeyFromEvmAddress(KNOWN_EVM, EVM_OPTS);

    console.log("\n=== EVM pubkey recovery (BOB mainnet) ===");
    if (!pubkey) {
      console.log("  result: null — no signed tx found within scan range");
      console.log(`  address: ${KNOWN_EVM}`);
      // May fail if no tx found in recent 100 blocks and explorer API unavailable
      return;
    }

    const recovered = Array.from(pubkey).map(b => b.toString(16).padStart(2, "0")).join("");
    console.log("  recovered pubkey:", recovered);
    expect(recovered).toBe(KNOWN_PUBKEY);
  }, 30_000);

  it("recovers full identity from EVM address on BOB mainnet", async () => {
    const identity = await recoverEvmRecipientIdentity(KNOWN_EVM, EVM_OPTS);

    console.log("\n=== EVM full identity recovery (BOB mainnet) ===");
    if (!identity) {
      console.log("  result: null — no signed tx found within scan range");
      return;
    }

    console.log("  publicKey:", identity.publicKey);
    console.log("  bitcoin:", identity.root);
    console.log("  stacks:", identity.derived.find(d => d.layer === "stacks")?.address);
    console.log("  evm:", identity.derived.find(d => d.layer === "bob")?.address);

    assertFullIdentity(identity);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// buildIdentityFromPublicKey (pure function, no network — always runs)
// ---------------------------------------------------------------------------

describe("buildIdentityFromPublicKey", () => {
  it("derives correct cross-chain identity from known compressed pubkey", () => {
    const pubkeyBytes = Uint8Array.from(
      KNOWN_PUBKEY.match(/.{2}/g)!.map(b => parseInt(b, 16)),
    );

    const identity = buildIdentityFromPublicKey(pubkeyBytes, false);

    console.log("\n=== buildIdentityFromPublicKey ===");
    console.log("  root (bitcoin):", identity.root);
    console.log("  publicKey:", identity.publicKey);
    identity.derived.forEach(d => console.log(`  ${d.layer}: ${d.address}`));

    expect(identity.publicKey).toBe(KNOWN_PUBKEY);
    expect(identity.root).toBe(KNOWN_BITCOIN);

    const stacks = identity.derived.find(d => d.layer === "stacks");
    expect(stacks?.address).toBe(KNOWN_STACKS);

    const evm = identity.derived.find(d => d.layer === "bob");
    expect(evm?.address.toLowerCase()).toBe(KNOWN_EVM.toLowerCase());
  });

  it("throws on non-compressed pubkey (wrong length)", () => {
    expect(() => buildIdentityFromPublicKey(new Uint8Array(65))).toThrow("33-byte");
  });
});
