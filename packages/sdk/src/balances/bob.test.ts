// ---------------------------------------------------------------------------
// bob.test.ts — unit tests for fetchBobBalances
//
// Strategy: mock the evm-client module so createEvmClient returns a
// fake PublicClient with controlled getBalance / readContract responses.
// This keeps tests fast and offline — no real RPC calls.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchBobBalances, BOB_WRAPPED_BTC_TOKENS, type BobWrappedBtcToken } from "../balances/bob.js";
import type { Address } from "viem";

const MOCK_ADDRESS: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// 0.1 ETH in wei
const ETH_BALANCE = 100_000_000_000_000_000n;
// 0.05 wBTC in smallest unit (8 decimals = 5_000_000 sats)
const WBTC_BALANCE = 5_000_000n;

// ---------------------------------------------------------------------------
// Mock evm-client — return a fake PublicClient for all tests
// ---------------------------------------------------------------------------

const mockGetBalance = vi.fn();
const mockReadContract = vi.fn();

vi.mock("../balances/evm-client.js", () => ({
  createEvmClient: () => ({
    getBalance: mockGetBalance,
    readContract: mockReadContract,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBalance.mockResolvedValue(ETH_BALANCE);
  mockReadContract.mockResolvedValue(WBTC_BALANCE);
});

// ---------------------------------------------------------------------------
// Mainnet tests
// ---------------------------------------------------------------------------

describe("fetchBobBalances — mainnet", () => {
  it("returns ETH entry + one entry per wrapped BTC token", async () => {
    const results = await fetchBobBalances(MOCK_ADDRESS, false);

    // 1 ETH + 1 default token (wBTC)
    expect(results).toHaveLength(1 + BOB_WRAPPED_BTC_TOKENS.length);
  });

  it("ETH entry: correct fields, isBtc=false", async () => {
    const results = await fetchBobBalances(MOCK_ADDRESS, false);
    const eth = results.find((r) => r.asset === "ETH")!;

    expect(eth).toBeDefined();
    expect(eth.balance).toBe(ETH_BALANCE);
    expect(eth.decimals).toBe(18);
    expect(eth.isBtc).toBe(false);
    expect(eth.kind).toBe("native");
    expect(eth.layer).toBe("bob");
    expect(eth.testnet).toBe(false);
    expect(eth.error).toBeUndefined();
  });

  it("wBTC entry: correct fields, isBtc=true", async () => {
    const results = await fetchBobBalances(MOCK_ADDRESS, false);
    const wbtc = results.find((r) => r.asset === "wBTC")!;

    expect(wbtc).toBeDefined();
    expect(wbtc.balance).toBe(WBTC_BALANCE);
    expect(wbtc.decimals).toBe(8);
    expect(wbtc.isBtc).toBe(true);
    expect(wbtc.kind).toBe("token");
    expect(wbtc.layer).toBe("bob");
    expect(wbtc.testnet).toBe(false);
    expect(wbtc.error).toBeUndefined();
  });

  it("uses the mainnet contract address for readContract", async () => {
    await fetchBobBalances(MOCK_ADDRESS, false);

    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: BOB_WRAPPED_BTC_TOKENS[0].mainnet,
        functionName: "balanceOf",
        args: [MOCK_ADDRESS],
      }),
    );
  });

  it("supports multiple wrapped BTC tokens", async () => {
    const customTokens: BobWrappedBtcToken[] = [
      {
        asset: "wBTC",
        mainnet: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
        testnet: "0x0000000000000000000000000000000000000000",
        decimals: 8,
      },
      {
        asset: "tBTC",
        mainnet: "0xBBa2eF945D523C4e2608C9E1214C2Cc64D4fc2e2",
        testnet: "0x0000000000000000000000000000000000000000",
        decimals: 18,
      },
    ];

    mockReadContract
      .mockResolvedValueOnce(5_000_000n)        // wBTC
      .mockResolvedValueOnce(50_000_000_000_000_000n); // tBTC

    const results = await fetchBobBalances(MOCK_ADDRESS, false, customTokens);

    expect(results).toHaveLength(3); // ETH + wBTC + tBTC
    expect(results.find((r) => r.asset === "wBTC")?.balance).toBe(5_000_000n);
    expect(results.find((r) => r.asset === "tBTC")?.balance).toBe(50_000_000_000_000_000n);
  });
});

// ---------------------------------------------------------------------------
// Testnet tests
// ---------------------------------------------------------------------------

describe("fetchBobBalances — testnet (bobSepolia)", () => {
  it("sets testnet=true on all entries", async () => {
    const results = await fetchBobBalances(MOCK_ADDRESS, true);

    for (const entry of results) {
      expect(entry.testnet).toBe(true);
    }
  });

  it("uses the testnet contract address for readContract", async () => {
    await fetchBobBalances(MOCK_ADDRESS, true);

    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: BOB_WRAPPED_BTC_TOKENS[0].testnet,
        functionName: "balanceOf",
        args: [MOCK_ADDRESS],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Error isolation
// ---------------------------------------------------------------------------

describe("fetchBobBalances — error handling", () => {
  it("ETH failure is isolated — token entries still succeed", async () => {
    mockGetBalance.mockRejectedValue(new Error("RPC unavailable"));
    mockReadContract.mockResolvedValue(WBTC_BALANCE);

    const results = await fetchBobBalances(MOCK_ADDRESS, false);
    const eth = results.find((r) => r.asset === "ETH")!;
    const wbtc = results.find((r) => r.asset === "wBTC")!;

    expect(eth.balance).toBe(0n);
    expect(eth.error).toBe("RPC unavailable");
    expect(wbtc.balance).toBe(WBTC_BALANCE);
    expect(wbtc.error).toBeUndefined();
  });

  it("token failure is isolated — ETH entry still succeeds", async () => {
    mockGetBalance.mockResolvedValue(ETH_BALANCE);
    mockReadContract.mockRejectedValue(new Error("contract call failed"));

    const results = await fetchBobBalances(MOCK_ADDRESS, false);
    const eth = results.find((r) => r.asset === "ETH")!;
    const wbtc = results.find((r) => r.asset === "wBTC")!;

    expect(eth.balance).toBe(ETH_BALANCE);
    expect(eth.error).toBeUndefined();
    expect(wbtc.balance).toBe(0n);
    expect(wbtc.error).toBe("contract call failed");
  });

  it("balance is 0n (not undefined) when a fetch fails", async () => {
    mockGetBalance.mockRejectedValue(new Error("timeout"));
    mockReadContract.mockRejectedValue(new Error("timeout"));

    const results = await fetchBobBalances(MOCK_ADDRESS, false);

    for (const entry of results) {
      expect(entry.balance).toBe(0n);
      expect(entry.error).toBeDefined();
    }
  });
});