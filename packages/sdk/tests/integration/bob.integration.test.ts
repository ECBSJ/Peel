// ---------------------------------------------------------------------------
// BOB integration tests — real chain, real values
//
// These tests hit the live BOB network (mainnet or bobSepolia). They are
// intentionally skipped in CI and meant to be run manually to validate the
// full pipeline against a real RPC.
//
// Usage:
//   pnpm test:integration
//
// For tests that involve signing and broadcasting, provide a private key:
//   TEST_PRIVATE_KEY=0x... pnpm test:integration
//
// The private key is only used locally in this file — it is never passed
// to OWS or any external service. Use a throwaway key with testnet funds only.
//
// Each `it` block is intentionally standalone so you can copy the logged
// values and validate them against OWS, Etherscan, or any other tool.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { keccak256, serializeTransaction } from "viem";
import { sign } from "viem/accounts";
import type { Hex } from "viem";
import {
  buildBobTokenTransfer,
  prepareBobTx,
  serializeBobTx,
  encodeBobSignedTx,
  broadcastBobTx,
  type EvmTxPrepared,
  type OwsSignResult,
} from "../../src/transactions/bob.js";
import { fetchBobBalances, BOB_WRAPPED_BTC_TOKENS } from "../../src/balances/bob.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// A known address with onchain activity on BOB mainnet — used for read-only
// tests. Replace with your own if desired.
const PROBE_ADDRESS = "0x32F249180D2d91A3a8EcAeBE9283Bde3C8903986" as Hex;

// For signing + broadcast tests: set TEST_PRIVATE_KEY in your environment.
// Use a throwaway key. testnet (bobSepolia) funds only.
//   export TEST_PRIVATE_KEY=0x<64 hex chars>
// @ts-ignore
const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex | undefined;
const TEST_RECIPIENT = "0x1111111111111111111111111111111111111111" as Hex;

// Skip signing/broadcast tests if no key is provided
const skipIfNoKey = !TEST_PRIVATE_KEY;

// ---------------------------------------------------------------------------
// Utility: derive sender address from private key (for signing tests)
// ---------------------------------------------------------------------------

async function senderFromPrivateKey(privateKey: Hex): Promise<Hex> {
  const { privateKeyToAccount } = await import("viem/accounts");
  return privateKeyToAccount(privateKey).address;
}

// ---------------------------------------------------------------------------
// Utility: sign an unsigned tx with a raw private key via viem
//
// This is the viem-native equivalent of OWS sign_transaction.
// Returns { r, s, v } so you can compare against OWS output byte-for-byte,
// then assembles an OwsSignResult for use with encodeBobSignedTx.
//
// OWS format: signature = hex(r[32] || s[32] || v[1])
// ---------------------------------------------------------------------------

async function signBobTxWithPrivateKey(
  prepared: EvmTxPrepared,
  privateKey: Hex,
): Promise<{ r: Hex; s: Hex; v: bigint | undefined; owsSig: OwsSignResult }> {
  // Serialize the unsigned tx — this is exactly what you'd hand to OWS
  const unsignedHex = serializeBobTx(prepared);

  // Hash the serialized bytes — what OWS keccak256's internally
  const hash = keccak256(unsignedHex);

  // Sign the hash with the raw private key
  const { r, s, v } = await sign({ hash, privateKey });

  // Assemble into OWS-compatible hex(r||s||v) format
  const sigHex =
    r.replace(/^0x/, "").padStart(64, "0") +
    s.replace(/^0x/, "").padStart(64, "0") +
    Number(v).toString(16).padStart(2, "0");

  return { r, s, v, owsSig: { signature: sigHex } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// @ts-ignore
describe.skipIf(process.env.CI)("BOB integration", () => {
  // -------------------------------------------------------------------------
  // 1. Balance fetching (read-only, mainnet)
  // -------------------------------------------------------------------------

  it("fetches real ETH + wBTC balances from BOB mainnet", async () => {
    const results = await fetchBobBalances(PROBE_ADDRESS, false);

    console.log("\n=== BOB mainnet balances ===");
    for (const entry of results) {
      console.log(`  ${entry.asset}: ${entry.balance} (decimals: ${entry.decimals})`);
    }

    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const entry of results) {
      expect(entry.error).toBeUndefined();
      expect(entry.balance).toBeGreaterThanOrEqual(0n);
    }
  }, 15_000);

  // -------------------------------------------------------------------------
  // 2. Prepare tx — fetch live nonce, gas, fee data and RLP-encode
  // -------------------------------------------------------------------------

  it("prepareBobTx returns fully populated fields and serializeBobTx produces 0x02... hex", async () => {
    const intent = buildBobTokenTransfer(
      PROBE_ADDRESS,
      TEST_RECIPIENT,
      BOB_WRAPPED_BTC_TOKENS[0].mainnet,
      1n, // 1 sat — smallest non-zero amount, safe for estimation
      false,
    );

    const prepared = await prepareBobTx(intent, false);

    console.log("\n=== Prepared tx fields ===");
    console.log("  chainId:              ", prepared.chainId);
    console.log("  nonce:                ", prepared.nonce);
    console.log("  gas:                  ", prepared.gas.toString());
    console.log("  maxFeePerGas:         ", prepared.maxFeePerGas.toString(), "wei");
    console.log("  maxPriorityFeePerGas: ", prepared.maxPriorityFeePerGas.toString(), "wei");
    console.log("  to (contract):        ", prepared.to);
    console.log("  value:                ", prepared.value.toString());
    console.log("  data:                 ", prepared.data.slice(0, 20), "...");

    const unsignedHex = serializeBobTx(prepared);

    console.log("\n=== Unsigned RLP-encoded tx ===");
    console.log("  (pass this to OWS sign_transaction or any EVM signer)");
    console.log(" ", unsignedHex);

    expect(prepared.nonce).toBeGreaterThanOrEqual(0);
    expect(prepared.gas).toBeGreaterThan(0n);
    expect(prepared.maxFeePerGas).toBeGreaterThan(0n);
    expect(unsignedHex.startsWith("0x02")).toBe(true);
  }, 15_000);

  // -------------------------------------------------------------------------
  // 3. Sign with a raw private key — shows r, s, v for external comparison
  // -------------------------------------------------------------------------

  // it.skipIf(skipIfNoKey)(
  //   "signBobTxWithPrivateKey returns r, s, v — compare against OWS output",
  //   async () => {
  //     const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

  //     const intent = buildBobTokenTransfer(
  //       sender,
  //       TEST_RECIPIENT,
  //       BOB_WRAPPED_BTC_TOKENS[0].testnet,
  //       1n,
  //       true, // bobSepolia — use testnet for signing tests
  //     );

  //     const prepared = await prepareBobTx(intent, true);
  //     const unsignedHex = serializeBobTx(prepared);
  //     const { r, s, v, owsSig } = await signBobTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);

  //     console.log("\n=== Signature components ===");
  //     console.log("  (compare these against OWS sign_transaction output)");
  //     console.log("  r:", r);
  //     console.log("  s:", s);
  //     console.log("  v:", v.toString());
  //     console.log("\n=== OWS-format signature (hex(r||s||v)) ===");
  //     console.log(" ", owsSig.signature);
  //     console.log("\n=== Unsigned tx (input to signer) ===");
  //     console.log(" ", unsignedHex);

  //     expect(r).toMatch(/^0x[0-9a-f]{64}$/i);
  //     expect(s).toMatch(/^0x[0-9a-f]{64}$/i);
  //     expect(v === 27n || v === 28n).toBe(true);
  //     expect(owsSig.signature).toHaveLength(130); // 65 bytes = 130 hex chars
  //   },
  //   15_000,
  // );

  // -------------------------------------------------------------------------
  // 4. Encode final signed tx payload
  // -------------------------------------------------------------------------

  // it.skipIf(skipIfNoKey)(
  //   "encodeBobSignedTx attaches signature and produces broadcast-ready 0x02... blob",
  //   async () => {
  //     const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

  //     const intent = buildBobTokenTransfer(
  //       sender,
  //       TEST_RECIPIENT,
  //       BOB_WRAPPED_BTC_TOKENS[0].testnet,
  //       1n,
  //       true,
  //     );

  //     const prepared = await prepareBobTx(intent, true);
  //     const { owsSig } = await signBobTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);
  //     const signedHex = encodeBobSignedTx(prepared, owsSig);

  //     console.log("\n=== Signed tx (broadcast-ready) ===");
  //     console.log("  (paste into Etherscan > Broadcast or use sendRawTransaction)");
  //     console.log(" ", signedHex);

  //     expect(signedHex.startsWith("0x02")).toBe(true);
  //     expect(signedHex.length).toBeGreaterThan(serializeBobTx(prepared).length);
  //   },
  //   15_000,
  // );

  // -------------------------------------------------------------------------
  // 5. Broadcast — sends the tx and returns a real tx hash
  // -------------------------------------------------------------------------

  // it.skipIf(skipIfNoKey)(
  //   "broadcastBobTx submits to bobSepolia and returns a tx hash",
  //   async () => {
  //     const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

  //     const intent = buildBobTokenTransfer(
  //       sender,
  //       TEST_RECIPIENT,
  //       BOB_WRAPPED_BTC_TOKENS[0].testnet,
  //       1n,
  //       true,
  //     );

  //     const prepared = await prepareBobTx(intent, true);
  //     const { owsSig } = await signBobTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);
  //     const signedHex = encodeBobSignedTx(prepared, owsSig);
  //     const txHash = await broadcastBobTx(signedHex, true);

  //     console.log("\n=== Broadcast result ===");
  //     console.log("  tx hash:", txHash);
  //     console.log(`  explorer: https://bob-sepolia.explorer.gobob.xyz/tx/${txHash}`);

  //     expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);
  //   },
  //   30_000,
  // );
});
