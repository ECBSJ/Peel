// ---------------------------------------------------------------------------
// Stacks integration tests — real chain, real values
//
// These tests hit the live Stacks testnet. They are intentionally skipped in
// CI and meant to be run manually with a funded testnet wallet.
//
// Usage:
//   pnpm test:integration
//
// Required env vars (from .env.local):
//   OWS_BRID_STACKS_TESTNET — Stacks testnet address (ST...) for balance/nonce reads
//   OWS_PUBKEY              — 33-byte compressed secp256k1 pubkey, hex (no 0x)
//   OWS_PRIVKEY             — raw private key hex (no 0x) for signing tests
//
// OWS real-world signing:
//   The preSignSigHash from prepareStacksTx is what OWS signs.
//   Use: ows sign tx --chain bitcoin --tx <preSignSigHash>
//   The payload is already hashed — OWS must not re-hash it.
//   OWS returns: r || s || v (v at end, raw recovery ID 0 or 1).
//   Pass directly to encodeStacksSignedTx.
//
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { sign } from "viem/accounts";
import type { Hex } from "viem";
import {
  buildStxTransfer,
  buildSbtcTransfer,
  prepareStacksTx,
  encodeStacksSignedTx,
  broadcastStacksTx,
  type StacksTxPrepared,
  type OwsSignResult,
} from "../../src/transactions/stacks.js";
import { fetchStacksBalances } from "../../src/balances/stacks.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// @ts-ignore
const PROBE_ADDRESS: string = process.env.OWS_BRID_STACKS_TESTNET ?? "";
// @ts-ignore
const PROBE_PUBKEY: string = process.env.OWS_PUBKEY ?? "";
// @ts-ignore
const TEST_PRIVATE_KEY = `0x${process.env.OWS_PRIVKEY}` as Hex | undefined;
const TEST_RECIPIENT = "ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87ND";

const HIRO_TESTNET = "https://api.testnet.hiro.so";
const STACKS_TESTNET_EXPLORER = "https://explorer.hiro.so/?chain=testnet";

const skipIfNoKey = !TEST_PRIVATE_KEY || process.env.OWS_PRIVKEY === "undefined";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function senderFromPrivateKey(privateKey: Hex): Promise<{ address: string; publicKey: string }> {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(privateKey);

  // viem returns the uncompressed public key (65 bytes, "04{x}{y}" prefix).
  // Stacks requires the compressed form (33 bytes, "02"/"03" prefix) —
  // equivalent to the Stacks convention of suffixing the private key with "01"
  // to indicate compressed-key derivation.
  let pubKeyHex = account.publicKey.replace(/^0x/, "");
  if (pubKeyHex.length === 130 && pubKeyHex.startsWith("04")) {
    const x = pubKeyHex.slice(2, 66);
    const yIsOdd = BigInt("0x" + pubKeyHex.slice(66)) % 2n !== 0n;
    pubKeyHex = (yIsOdd ? "03" : "02") + x;
  }

  const { publicKeyToAddress } = await import("@stacks/transactions");
  const stacksAddress = publicKeyToAddress(pubKeyHex, "testnet");

  return { address: stacksAddress, publicKey: pubKeyHex };
}

/**
 * Sign a Stacks preSignSigHash using a raw private key.
 * Produces an OWS-format signature: r || s || v (v at end, raw recovery ID 0/1).
 *
 * For real OWS signing, use:
 *   ows sign tx --chain bitcoin --tx <preSignSigHash>
 */
async function signStacksPreSignHash(
  preSignSigHash: string,
  privateKey: Hex,
): Promise<OwsSignResult> {
  // viem sign() signs the hash directly without re-hashing
  const { r, s, v } = await sign({
    hash: `0x${preSignSigHash}` as Hex,
    privateKey,
  });

  // viem returns v as 27n or 28n (legacy Ethereum form)
  // Normalize to raw recovery ID (0 or 1) for OWS-compatible format
  const recoveryId = v === 27n ? 0n : 1n;

  const sigHex =
    r.replace(/^0x/, "").padStart(64, "0") +
    s.replace(/^0x/, "").padStart(64, "0") +
    recoveryId.toString(16).padStart(2, "0");

  return { signature: sigHex };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// @ts-ignore
describe.skipIf(process.env.CI)("Stacks integration", () => {
  it("fetches real STX and sBTC balances from Stacks testnet", async () => {
    const results = await fetchStacksBalances(PROBE_ADDRESS, HIRO_TESTNET, true);

    console.log("\n=== Stacks testnet balances ===");
    for (const r of results) {
      if (r.error) {
        console.log(`  ${r.asset}: ERROR — ${r.error}`);
      } else {
        console.log(`  ${r.asset}: ${r.balance} (decimals: ${r.decimals})`);
      }
    }
    console.log(`  address: ${PROBE_ADDRESS}`);

    expect(results).toHaveLength(2);
    expect(results[0].asset).toBe("STX");
    expect(results[1].asset).toBe("sBTC");
    expect(results[0].error).toBeUndefined();
  }, 15_000);

  it("prepareStacksTx returns fully populated fields with preSignSigHash (STX transfer)", async () => {
    const intent = buildStxTransfer(
      PROBE_ADDRESS,
      TEST_RECIPIENT,
      1n, // 1 microSTX
      PROBE_PUBKEY,
      true,
    );

    const prepared = await prepareStacksTx(intent, 2000n, HIRO_TESTNET);

    console.log("\n=== Prepared STX tx fields ===");
    console.log("  type:           ", prepared.type);
    console.log("  nonce:          ", prepared.nonce.toString());
    console.log("  fee:            ", prepared.fee.toString(), "microSTX");
    console.log("  preSignSigHash: ", prepared.preSignSigHash);

    expect(prepared.type).toBe("stx-transfer");
    expect(prepared.nonce).toBeGreaterThanOrEqual(0n);
    expect(prepared.fee).toBe(2000n);
    expect(prepared.preSignSigHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared._wire).toBeDefined();
  }, 15_000);

  it("prepareStacksTx returns fully populated fields with preSignSigHash (sBTC transfer)", async () => {
    const intent = buildSbtcTransfer(
      PROBE_ADDRESS,
      TEST_RECIPIENT,
      1n, // 1 satoshi
      PROBE_PUBKEY,
      true,
    );

    const prepared = await prepareStacksTx(intent, 2000n, HIRO_TESTNET);

    console.log("\n=== Prepared sBTC tx fields ===");
    console.log("  type:           ", prepared.type);
    console.log("  nonce:          ", prepared.nonce.toString());
    console.log("  fee:            ", prepared.fee.toString(), "microSTX");
    console.log("  preSignSigHash: ", prepared.preSignSigHash);

    expect(prepared.type).toBe("sbtc-transfer");
    expect(prepared.nonce).toBeGreaterThanOrEqual(0n);
    expect(prepared.preSignSigHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared._wire).toBeDefined();
  }, 15_000);

  it.skipIf(skipIfNoKey)(
    "signStacksPreSignHash returns 65-byte OWS-format signature",
    async () => {
      const { address, publicKey } = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

      const intent = buildStxTransfer(address, TEST_RECIPIENT, 1n, publicKey, true);
      const prepared = await prepareStacksTx(intent, 2000n, HIRO_TESTNET);
      const owsSig = await signStacksPreSignHash(prepared.preSignSigHash, TEST_PRIVATE_KEY!);

      console.log("\n=== Stacks signature (OWS format: r || s || v) ===");
      console.log("  preSignSigHash:", prepared.preSignSigHash);
      console.log("  signature:     ", owsSig.signature);

      expect(owsSig.signature).toHaveLength(130);
      // v (last byte) must be 00 or 01
      expect(["00", "01"]).toContain(owsSig.signature.slice(128, 130));
    },
    15_000,
  );

  it.skipIf(skipIfNoKey)(
    "encodeStacksSignedTx attaches signature and produces signed tx hex (sBTC transfer)",
    async () => {
      const intent = buildSbtcTransfer(PROBE_ADDRESS, TEST_RECIPIENT, 1n, PROBE_PUBKEY, true);
      const prepared = await prepareStacksTx(intent, 2000n, HIRO_TESTNET);
      const owsSig = await signStacksPreSignHash(prepared.preSignSigHash, TEST_PRIVATE_KEY!);
      const signedHex = encodeStacksSignedTx(prepared, owsSig);

      console.log("\n=== Encoded signed Stacks tx ===");
      console.log("  signed hex length:", signedHex.length);
      console.log("  starts with:", signedHex.slice(0, 10));

      expect(typeof signedHex).toBe("string");
      expect(signedHex.length).toBeGreaterThan(0);
      expect(signedHex).toMatch(/^[0-9a-f]+$/i);
    },
    15_000,
  );

  it.skipIf(skipIfNoKey)(
    "broadcastStacksTx submits sBTC transfer to Stacks testnet and returns a txid",
    async () => {
      // Use PROBE_ADDRESS/PROBE_PUBKEY — the funded identity from env vars.
      // OWS_PRIVKEY is the corresponding signing key.
      const intent = buildSbtcTransfer(PROBE_ADDRESS, TEST_RECIPIENT, 1n, PROBE_PUBKEY, true);
      const prepared = await prepareStacksTx(intent, 2000n, HIRO_TESTNET);
      const owsSig = await signStacksPreSignHash(prepared.preSignSigHash, TEST_PRIVATE_KEY!);
      const signedHex = encodeStacksSignedTx(prepared, owsSig);
      const txid = await broadcastStacksTx(signedHex, true);

      console.log("\n=== Stacks testnet broadcast result (sBTC) ===");
      console.log("  txid:", txid);
      console.log(`  explorer: ${STACKS_TESTNET_EXPLORER}/txid/${txid}?chain=testnet`);

      expect(txid).toMatch(/^[0-9a-f]{64}$/i);
    },
    30_000,
  );
});
