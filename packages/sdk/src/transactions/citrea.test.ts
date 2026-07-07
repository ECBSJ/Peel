import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildCitreaTransfer,
  prepareCitreaTx,
  serializeCitreaTx,
  encodeCitreaSignedTx,
  broadcastCitreaTx,
  type CitreaTxRequest,
  type OwsSignResult,
} from "./citrea.js";
import { citrea, citreaTestnet } from "viem/chains";
import type { Address } from "viem";

const FROM: Address = "0x1111111111111111111111111111111111111111";
const TO: Address = "0x2222222222222222222222222222222222222222";

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
  mockGetTransactionCount.mockResolvedValue(9);
  mockEstimateGas.mockResolvedValue(21_000n);
  mockEstimateFeesPerGas.mockResolvedValue({
    maxFeePerGas: 1_500_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
  });
  mockSendRawTransaction.mockResolvedValue(
    "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
  );
});

describe("buildCitreaTransfer", () => {
  it("sets correct fields for mainnet", () => {
    const tx = buildCitreaTransfer(FROM, TO, 1n, false);
    expect(tx.from).toBe(FROM);
    expect(tx.to).toBe(TO);
    expect(tx.value).toBe(1n);
    expect(tx.data).toBe("0x");
    expect(tx.chainId).toBe(citrea.id);
  });

  it("uses citrea testnet chainId when testnet=true", () => {
    const tx = buildCitreaTransfer(FROM, TO, 1n, true);
    expect(tx.chainId).toBe(citreaTestnet.id);
  });
});

describe("prepareCitreaTx", () => {
  const baseTx: CitreaTxRequest = {
    from: FROM,
    to: TO,
    value: 1_000_000n,
    data: "0x",
    chainId: citrea.id,
  };

  it("populates nonce, gas and fee fields", async () => {
    const prepared = await prepareCitreaTx(baseTx, false);
    expect(prepared.nonce).toBe(9);
    expect(prepared.gas).toBe(21_000n);
    expect(prepared.maxFeePerGas).toBe(1_500_000_000n);
    expect(prepared.maxPriorityFeePerGas).toBe(1_000_000n);
    expect(prepared.type).toBe("eip1559");
  });
});

describe("serializeCitreaTx", () => {
  it("produces an EIP-1559 hex payload", async () => {
    const prepared = await prepareCitreaTx(
      { from: FROM, to: TO, value: 0n, data: "0x", chainId: citrea.id },
      false,
    );
    const serialized = serializeCitreaTx(prepared);
    expect(serialized.startsWith("0x02")).toBe(true);
  });
});

describe("encodeCitreaSignedTx", () => {
  const preparedTx = {
    from: FROM,
    to: TO,
    value: 0n,
    data: "0x" as `0x${string}`,
    chainId: citrea.id,
    nonce: 9,
    gas: 21_000n,
    maxFeePerGas: 1_500_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    type: "eip1559" as const,
  };

  const sig: OwsSignResult = {
    signature: "aa".repeat(32) + "bb".repeat(32) + "1b",
  };

  it("produces a signed tx", () => {
    const signed = encodeCitreaSignedTx(preparedTx, sig);
    expect(signed.startsWith("0x02")).toBe(true);
    expect(signed.length).toBeGreaterThan(serializeCitreaTx(preparedTx).length);
  });

  it("throws on invalid signature length", () => {
    expect(() => encodeCitreaSignedTx(preparedTx, { signature: "aabb" })).toThrow(
      "65-byte signature",
    );
  });
});

describe("broadcastCitreaTx", () => {
  const signedHex = ("0x02f8" + "ab".repeat(50)) as `0x${string}`;

  it("sends serialized tx and returns hash", async () => {
    const hash = await broadcastCitreaTx(signedHex, false);
    expect(mockSendRawTransaction).toHaveBeenCalledWith({
      serializedTransaction: signedHex,
    });
    expect(hash).toBe(
      "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    );
  });
});
