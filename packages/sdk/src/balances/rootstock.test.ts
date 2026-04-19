import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchRootstockBalance } from "../balances/rootstock.js";

const RPC_URL = "https://public-node.rsk.co";
const MOCK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// 0.05 RBTC in wei
const RBTC_WEI_HEX = "0xb1a2bc2ec50000"; // 50_000_000_000_000_000n

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchRootstockBalance", () => {
  it("returns RBTC native balance in wei", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: RBTC_WEI_HEX }),
    }));

    const result = await fetchRootstockBalance(MOCK_ADDRESS, RPC_URL, false);

    expect(result.layer).toBe("rootstock");
    expect(result.asset).toBe("RBTC");
    expect(result.kind).toBe("native");
    expect(result.balance).toBe(50_000_000_000_000_000n);
    expect(result.decimals).toBe(18);
    expect(result.isBtc).toBe(true);
    expect(result.testnet).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("converts to satoshis correctly (50_000_000_000_000_000 wei = 5_000_000 sats)", () => {
    // This is a unit check of the conversion math: wei / 10^10
    const wei = 50_000_000_000_000_000n;
    const sats = wei / 10n ** 10n;
    expect(sats).toBe(5_000_000n); // 0.05 BTC
  });

  it("returns 0n and error on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    }));

    const result = await fetchRootstockBalance(MOCK_ADDRESS, RPC_URL, false);

    expect(result.balance).toBe(0n);
    expect(result.error).toContain("502");
  });

  it("returns 0n and error on RPC error response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { message: "execution reverted" } }),
    }));

    const result = await fetchRootstockBalance(MOCK_ADDRESS, RPC_URL, false);

    expect(result.balance).toBe(0n);
    expect(result.error).toBe("execution reverted");
  });

  it("returns 0n and error on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await fetchRootstockBalance(MOCK_ADDRESS, RPC_URL, false);

    expect(result.balance).toBe(0n);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("sends correct eth_getBalance JSON-RPC request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: RBTC_WEI_HEX }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchRootstockBalance(MOCK_ADDRESS, RPC_URL, false);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RPC_URL);
    const body = JSON.parse(init.body as string);
    expect(body.method).toBe("eth_getBalance");
    expect(body.params[0]).toBe(MOCK_ADDRESS);
    expect(body.params[1]).toBe("latest");
  });

  it("sets testnet flag correctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "0x0" }),
    }));

    const result = await fetchRootstockBalance(MOCK_ADDRESS, RPC_URL, true);
    expect(result.testnet).toBe(true);
  });
});
