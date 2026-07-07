// ---------------------------------------------------------------------------
// Rootstock integration tests — real chain, real values
//
// These tests hit the live Rootstock network (mainnet or testnet). They are
// intentionally skipped in CI and meant to be run manually.
//
// Usage:
//   pnpm test:integration
//
// For tests that involve signing and broadcasting, provide a private key:
//   OWS_PRIVKEY=<hex-without-0x> pnpm test:integration
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { keccak256 } from "viem";
import { sign } from "viem/accounts";
import type { Hex } from "viem";
import { rootstock, rootstockTestnet } from "viem/chains";
import {
  buildRootstockTransfer,
  prepareRootstockTx,
  serializeRootstockTx,
  encodeRootstockSignedTx,
  broadcastRootstockTx,
  type RootstockTxPrepared,
  type OwsSignResult,
} from "../../src/transactions/rootstock.js";
import { fetchRootstockBalance } from "../../src/balances/rootstock.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// @ts-ignore
const PROBE_ADDRESS = process.env.OWS_BRID_EVM as Hex;
// @ts-ignore
const TEST_PRIVATE_KEY = `0x${process.env.OWS_PRIVKEY}` as Hex | undefined;
const TEST_RECIPIENT = "0x32F249180D2d91A3a8EcAeBE9283Bde3C8903986" as Hex;

const ROOTSTOCK_MAINNET_RPC = rootstock.rpcUrls.default.http[0];
const ROOTSTOCK_TESTNET_RPC = rootstockTestnet.rpcUrls.default.http[0];

const skipIfNoKey = !TEST_PRIVATE_KEY;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function senderFromPrivateKey(privateKey: Hex): Promise<Hex> {
  const { privateKeyToAccount } = await import("viem/accounts");
  return privateKeyToAccount(privateKey).address;
}

async function signRootstockTxWithPrivateKey(
  prepared: RootstockTxPrepared,
  privateKey: Hex,
): Promise<{ r: Hex; s: Hex; v: bigint | undefined; owsSig: OwsSignResult }> {
  const unsignedHex = serializeRootstockTx(prepared);
  const hash = keccak256(unsignedHex);
  const { r, s, v } = await sign({ hash, privateKey });

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
describe.skipIf(process.env.CI)("Rootstock integration", () => {
  it("fetches real RBTC balance from Rootstock mainnet", async () => {
    const result = await fetchRootstockBalance(PROBE_ADDRESS, ROOTSTOCK_MAINNET_RPC, false);

    console.log("\n=== Rootstock mainnet balance ===");
    console.log(`  ${result.asset}: ${result.balance} (decimals: ${result.decimals})`);

    expect(result.error).toBeUndefined();
    expect(result.asset).toBe("RBTC");
    expect(result.balance).toBeGreaterThanOrEqual(0n);
  }, 15_000);

  it("prepareRootstockTx returns fully populated fields and serializeRootstockTx produces a legacy hex tx", async () => {
    const intent = buildRootstockTransfer(
      PROBE_ADDRESS,
      TEST_RECIPIENT,
      1n, // 1 wei
      false,
    );

    const prepared = await prepareRootstockTx(intent, false);

    console.log("\n=== Prepared Rootstock tx fields ===");
    console.log("  chainId:              ", prepared.chainId);
    console.log("  nonce:                ", prepared.nonce);
    console.log("  gas:                  ", prepared.gas.toString());
    console.log("  gasPrice:             ", prepared.gasPrice.toString(), "wei");

    const unsignedHex = serializeRootstockTx(prepared);

    expect(prepared.nonce).toBeGreaterThanOrEqual(0);
    expect(prepared.gas).toBeGreaterThan(0n);
    expect(prepared.gasPrice).toBeGreaterThan(0n);
    expect(unsignedHex.startsWith("0x02")).toBe(false);
  }, 15_000);

  it.skipIf(skipIfNoKey)(
    "signRootstockTxWithPrivateKey returns r, s, v — compare against OWS output",
    async () => {
      const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

      const intent = buildRootstockTransfer(
        sender,
        TEST_RECIPIENT,
        1n,
        true,
      );

      const prepared = await prepareRootstockTx(intent, true, ROOTSTOCK_TESTNET_RPC);
      const { r, s, v, owsSig } = await signRootstockTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);

      console.log("\n=== Rootstock signature components ===");
      console.log("  r:", r);
      console.log("  s:", s);
      console.log("  v:", v!.toString());
      console.log("  owsSig:", owsSig.signature);

      expect(r).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(s).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(v === 27n || v === 28n).toBe(true);
      expect(owsSig.signature).toHaveLength(130);
    },
    15_000,
  );

  it.skipIf(skipIfNoKey)(
    "encodeRootstockSignedTx attaches signature and produces broadcast-ready legacy tx",
    async () => {
      const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

      const intent = buildRootstockTransfer(
        sender,
        TEST_RECIPIENT,
        1n,
        true,
      );

      const prepared = await prepareRootstockTx(intent, true, ROOTSTOCK_TESTNET_RPC);
      const { owsSig } = await signRootstockTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);
      const signedHex = encodeRootstockSignedTx(prepared, owsSig);

      expect(signedHex.startsWith("0x02")).toBe(false);
      expect(signedHex.length).toBeGreaterThan(serializeRootstockTx(prepared).length);
    },
    15_000,
  );

  it.skipIf(skipIfNoKey)(
    "broadcastRootstockTx submits to Rootstock testnet and returns a tx hash",
    async () => {
      const sender = await senderFromPrivateKey(TEST_PRIVATE_KEY!);

      const intent = buildRootstockTransfer(
        sender,
        TEST_RECIPIENT,
        1n,
        true,
      );

      const prepared = await prepareRootstockTx(intent, true, ROOTSTOCK_TESTNET_RPC);
      const { owsSig } = await signRootstockTxWithPrivateKey(prepared, TEST_PRIVATE_KEY!);
      const signedHex = encodeRootstockSignedTx(prepared, owsSig);
      const txHash = await broadcastRootstockTx(signedHex, true, ROOTSTOCK_TESTNET_RPC);

      console.log("\n=== Rootstock testnet broadcast result ===");
      console.log("  tx hash:", txHash);
      console.log(`  explorer: https://explorer.testnet.rsk.co/tx/${txHash}`);

      expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);
    },
    30_000,
  );
});
