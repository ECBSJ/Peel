// ---------------------------------------------------------------------------
// bob transaction tests
//
// build* functions: pure — no mocking needed.
// prepareBobTx: mocks evm-client (network calls).
// encodeBobSignedTx: pure — just RLP + signature assembly.
// broadcastBobTx: mocks evm-client (network call).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildBobEthTransfer,
  buildBobTokenTransfer,
  prepareBobTx,
  serializeBobTx,
  encodeBobSignedTx,
  broadcastBobTx,
  type EvmTxRequest,
  type OwsSignResult,
} from "../transactions/bob.js";
import { bob, bobSepolia } from "viem/chains";
import { decodeFunctionData, erc20Abi, parseTransaction } from "viem";
import type { Address } from "viem";

const FROM: Address = "0x1111111111111111111111111111111111111111";
const TO: Address = "0x2222222222222222222222222222222222222222";
const WBTC_CONTRACT: Address = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

// ---------------------------------------------------------------------------
// Mock evm-client for prepare + broadcast tests
// ---------------------------------------------------------------------------

const mockGetTransactionCount = vi.fn();
const mockEstimateGas = vi.fn();
const mockEstimateFeesPerGas = vi.fn();
const mockSendRawTransaction = vi.fn();

vi.mock("../balances/evm-client.js", () => ({
  createEvmClient: () => ({
    getTransactionCount: mockGetTransactionCount,
    estimateGas: mockEstimateGas,
    estimateFeesPerGas: mockEstimateFeesPerGas,
    sendRawTransaction: mockSendRawTransaction,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTransactionCount.mockResolvedValue(5);
  mockEstimateGas.mockResolvedValue(21000n);
  mockEstimateFeesPerGas.mockResolvedValue({
    maxFeePerGas: 1_500_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
  });
  mockSendRawTransaction.mockResolvedValue(
    "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
  );
});

// ---------------------------------------------------------------------------
// buildBobEthTransfer
// ---------------------------------------------------------------------------

describe("buildBobEthTransfer", () => {
  it("sets correct from, to, value", () => {
    const tx = buildBobEthTransfer(FROM, TO, 1_000_000_000_000_000n, false);
    expect(tx.from).toBe(FROM);
    expect(tx.to).toBe(TO);
    expect(tx.value).toBe(1_000_000_000_000_000n);
  });

  it("data is 0x for a plain ETH transfer", () => {
    const tx = buildBobEthTransfer(FROM, TO, 1n, false);
    expect(tx.data).toBe("0x");
  });

  it("uses BOB mainnet chainId (60808) when testnet=false", () => {
    const tx = buildBobEthTransfer(FROM, TO, 1n, false);
    expect(tx.chainId).toBe(bob.id);
  });

  it("uses bobSepolia chainId (808813) when testnet=true", () => {
    const tx = buildBobEthTransfer(FROM, TO, 1n, true);
    expect(tx.chainId).toBe(bobSepolia.id);
  });
});

// ---------------------------------------------------------------------------
// buildBobTokenTransfer
// ---------------------------------------------------------------------------

describe("buildBobTokenTransfer", () => {
  it("to field is the token contract, not the recipient", () => {
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, 5_000_000n, false);
    expect(tx.to).toBe(WBTC_CONTRACT);
    expect(tx.to).not.toBe(TO);
  });

  it("value is 0n — no ETH sent with a token transfer", () => {
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, 5_000_000n, false);
    expect(tx.value).toBe(0n);
  });

  it("calldata decodes to transfer(recipient, amount)", () => {
    const amount = 5_000_000n;
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, amount, false);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args[0]).toBe(TO);
    expect(decoded.args[1]).toBe(amount);
  });

  it("works with large amounts (no bigint overflow)", () => {
    const maxSats = 2_100_000_000_000_000n;
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, maxSats, false);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    expect(decoded.args[1]).toBe(maxSats);
  });
});

// ---------------------------------------------------------------------------
// prepareBobTx
// ---------------------------------------------------------------------------

describe("prepareBobTx", () => {
  const baseTx: EvmTxRequest = {
    from: FROM,
    to: TO,
    value: 1_000_000n,
    data: "0x",
    chainId: bob.id,
  };

  it("populates nonce from getTransactionCount", async () => {
    const prepared = await prepareBobTx(baseTx, false);
    expect(prepared.nonce).toBe(5);
  });

  it("populates gas from estimateGas", async () => {
    const prepared = await prepareBobTx(baseTx, false);
    expect(prepared.gas).toBe(21000n);
  });

  it("populates maxFeePerGas and maxPriorityFeePerGas from estimateFeesPerGas", async () => {
    const prepared = await prepareBobTx(baseTx, false);
    expect(prepared.maxFeePerGas).toBe(1_500_000_000n);
    expect(prepared.maxPriorityFeePerGas).toBe(1_000_000n);
  });

  it("preserves from, to, value, data, chainId from the intent", async () => {
    const prepared = await prepareBobTx(baseTx, false);
    expect(prepared.from).toBe(FROM);
    expect(prepared.to).toBe(TO);
    expect(prepared.value).toBe(1_000_000n);
    expect(prepared.data).toBe("0x");
    expect(prepared.chainId).toBe(bob.id);
  });

  it("type is eip1559", async () => {
    const prepared = await prepareBobTx(baseTx, false);
    expect(prepared.type).toBe("eip1559");
  });
});

// ---------------------------------------------------------------------------
// serializeBobTx
// ---------------------------------------------------------------------------

describe("serializeBobTx", () => {
  it("produces a hex string starting with 0x02 (EIP-1559 type prefix)", async () => {
    const baseTx: EvmTxRequest = { from: FROM, to: TO, value: 0n, data: "0x", chainId: bob.id };
    const prepared = await prepareBobTx(baseTx, false);
    const serialized = serializeBobTx(prepared);
    expect(serialized.startsWith("0x02")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// encodeBobSignedTx
// ---------------------------------------------------------------------------

describe("encodeBobSignedTx", () => {
  // Minimal valid prepared tx
  const preparedTx = {
    from: FROM,
    to: TO,
    value: 0n,
    data: "0x" as `0x${string}`,
    chainId: bob.id,
    nonce: 5,
    gas: 21000n,
    maxFeePerGas: 1_500_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    type: "eip1559" as const,
  };

  // A syntactically valid 65-byte signature (r=aa*32, s=bb*32, v=00)
  const mockSig: OwsSignResult = {
    signature: "aa".repeat(32) + "bb".repeat(32) + "1b",
  };

  it("produces a hex string starting with 0x02", () => {
    const signed = encodeBobSignedTx(preparedTx, mockSig);
    expect(signed.startsWith("0x02")).toBe(true);
  });

  it("signed tx is longer than unsigned (signature was appended)", () => {
    const unsigned = serializeBobTx(preparedTx);
    const signed = encodeBobSignedTx(preparedTx, mockSig);
    expect(signed.length).toBeGreaterThan(unsigned.length);
  });

  it("throws if signature is not 65 bytes (130 hex chars)", () => {
    const badSig: OwsSignResult = { signature: "aabb" };
    expect(() => encodeBobSignedTx(preparedTx, badSig)).toThrow("65-byte signature");
  });

  it("accepts signature with 0x prefix", () => {
    const sigWith0x: OwsSignResult = { signature: "0x" + "aa".repeat(32) + "bb".repeat(32) + "1b" };
    expect(() => encodeBobSignedTx(preparedTx, sigWith0x)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// broadcastBobTx
// ---------------------------------------------------------------------------

describe("broadcastBobTx", () => {
  const signedHex = ("0x02f8" + "ab".repeat(50)) as `0x${string}`;

  it("calls sendRawTransaction with the signed hex", async () => {
    await broadcastBobTx(signedHex, false);
    expect(mockSendRawTransaction).toHaveBeenCalledWith({
      serializedTransaction: signedHex,
    });
  });

  it("returns the tx hash from the node", async () => {
    const hash = await broadcastBobTx(signedHex, false);
    expect(hash).toBe("0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1");
  });

  it("uses mainnet client when testnet=false", async () => {
    await broadcastBobTx(signedHex, false);
    expect(mockSendRawTransaction).toHaveBeenCalledTimes(1);
  });
});
