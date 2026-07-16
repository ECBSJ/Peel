// ---------------------------------------------------------------------------
// Citrea integration tests — real chain, real values
//
// These tests hit the live Citrea testnet. They are intentionally skipped in
// CI and meant to be run manually with a funded testnet wallet.
//
// Usage:
//   pnpm test:integration
//
// For tests that involve signing and broadcasting, provide a private key:
//   OWS_PRIVKEY=<hex-without-0x> pnpm test:integration
//
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { keccak256 } from "viem";
import { sign } from "viem/accounts";
import type { Hex } from "viem";
import { citreaTestnet } from "viem/chains";
import {
  buildCitreaTransfer,
  prepareCitreaTx,
  serializeCitreaTx,
  encodeCitreaSignedTx,
  broadcastCitreaTx,
  type CitreaTxPrepared,
  type OwsSignResult,
} from "../../src/transactions/citrea.js";
import { fetchCitreaBalance } from "../../src/balances/citrea.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// @ts-ignore
const PROBE_ADDRESS = process.env.OWS_BRID_EVM as Hex;
// @ts-ignore
const TEST_PRIVATE_KEY = `0x${process.env.OWS_PRIVKEY}` as Hex | undefined;
const TEST_RECIPIENT = "0x32F249180D2d91A3a8EcAeBE9283Bde3C8903986" as Hex;

const CITREA_TESTNET_RPC = citreaTestnet.rpcUrls.default.http[0];
const CITREA_TESTNET_EXPLORER = citreaTestnet.blockExplorers!.default.url;

const skipIfNoKey = !TEST_PRIVATE_KEY;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function senderFromPrivateKey(privateKey: Hex): Promise<Hex> {
  const { privateKeyToAccount } = await import("viem/accounts");
  return privateKeyToAccount(privateKey).address;
}

async function signCitreaTxWithPrivateKey(
  prepared: CitreaTxPrepared,
  privateKey: Hex,
): Promise<{ r: Hex; s: Hex; v: bigint | undefined; owsSig: OwsSignResult }> {
  const unsignedHex = serializeCitreaTx(prepared);
  const hash = keccak256(unsignedHex);
  const { r, s, v } = await sign({ hash, privateKey });

  // EIP-1559 (type 2): v is yParity — 0 or 1. No EIP-155 conversion needed.
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
describe.skipIf(process.env.CI)("Citrea integration", () => {
  it("fetches real cBTC balance from Citrea testnet", async () => {
    const result = await fetchCitreaBalance(PROBE_ADDRESS, CITREA_TESTNET_RPC, true);

    console.log("\n=== Citrea testnet balance ===");
    console.log(`  ${result.asset}: ${result.balance} (decimals: ${result.decimals})`);
    console.log(`  address: ${PROBE_ADDRESS}`);

    expect(result.error).toBeUndefined();
    expect(result.asset).toBe("cBTC");
    expect(result.balance).toBeGreaterThanOrEqual(0n);
  }, 15_000);

  it("prepareCitreaTx returns fully populated fields and serializeCitreaTx produces 0x02... hex", async () => {
    const intent = buildCitreaTransfer(
      PROBE_ADDRESS,
      TEST_RECIPIENT,
      1n, // 1 wei
      true,
    );

    const prepared = await prepareCitreaTx(intent, true, CITREA_TESTNET_RPC);

    console.log("\n=== Prepared Citrea tx fields ===");
    console.log("  chainId:                ", prepared.chainId);
    console.log("  nonce:                  ", prepared.nonce);
    console.log("  gas:                    ", prepared.gas.toString());
    console.log("  maxFeePerGas:           ", prepared.maxFeePerGas.toString(), "wei");
    console.log("  maxPriorityFeePerGas:   ", prepared.maxPriorityFeePerGas.toString(), "wei");
    console.log("  type:                   ", prepared.type);

    const unsignedHex = serializeCitreaTx(prepared);

    expect(prepared.chainId).toBe(citreaTestnet.id);
    expect(prepared.type).toBe("eip1559");
    expect(prepared.nonce).toBeGreaterThanOrEqual(0);
    expect(prepared.gas).toBeGreaterThan(0n);
    expect(prepared.maxFeePerGas).toBeGreaterThan(0n);
    expect(unsignedHex.startsWith("0x02")).toBe(true);
  }, 15_000);

  it.skipIf(skipIfNoKey)(
    "signCitreaTxWithPrivateKey returns r, s, v — compare against OWS output",
    async () => {
      const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

      const intent = buildCitreaTransfer(
        sender,
        TEST_RECIPIENT,
        1n,
        true,
      );

      const prepared = await prepareCitreaTx(intent, true, CITREA_TESTNET_RPC);
      const { r, s, v, owsSig } = await signCitreaTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);

      console.log("\n=== Citrea signature components ===");
      console.log("  r:", r);
      console.log("  s:", s);
      console.log("  v (yParity):", v!.toString());
      console.log("  owsSig:", owsSig.signature);

      expect(r).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(s).toMatch(/^0x[0-9a-f]{64}$/i);
      // EIP-1559 yParity: 0 or 1
      expect(v === 0n || v === 1n).toBe(true);
      expect(owsSig.signature).toHaveLength(130);
    },
    15_000,
  );

  it.skipIf(skipIfNoKey)(
    "encodeCitreaSignedTx attaches signature and produces broadcast-ready 0x02... blob",
    async () => {
      const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

      const intent = buildCitreaTransfer(
        sender,
        TEST_RECIPIENT,
        1n,
        true,
      );

      const prepared = await prepareCitreaTx(intent, true, CITREA_TESTNET_RPC);
      const { owsSig } = await signCitreaTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);
      const signedHex = encodeCitreaSignedTx(prepared, owsSig);

      console.log("\n=== Encoded signed Citrea tx ===");
      console.log("  unsigned length:", serializeCitreaTx(prepared).length);
      console.log("  signed length:  ", signedHex.length);

      expect(signedHex.startsWith("0x02")).toBe(true);
      expect(signedHex.length).toBeGreaterThan(serializeCitreaTx(prepared).length);
    },
    15_000,
  );

  it.skipIf(skipIfNoKey)(
    "broadcastCitreaTx submits to Citrea testnet and returns a tx hash",
    async () => {
      const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

      const intent = buildCitreaTransfer(
        sender,
        TEST_RECIPIENT,
        1n,
        true,
      );

      const prepared = await prepareCitreaTx(intent, true, CITREA_TESTNET_RPC);
      const { owsSig } = await signCitreaTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);
      const signedHex = encodeCitreaSignedTx(prepared, owsSig);
      const txHash = await broadcastCitreaTx(signedHex, true, CITREA_TESTNET_RPC);

      console.log("\n=== Citrea testnet broadcast result ===");
      console.log("  tx hash:", txHash);
      console.log(`  explorer: ${CITREA_TESTNET_EXPLORER}/tx/${txHash}`);

      expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);
    },
    30_000,
  );
});
