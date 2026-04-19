import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchBitcoinBalance } from "../balances/bitcoin.js";

const BASE_URL = "https://mempool.space/api";

const MOCK_ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

const MOCK_RESPONSE = {
  chain_stats: {
    funded_txo_sum: 500_000,
    spent_txo_sum: 200_000,
  },
  mempool_stats: {
    funded_txo_sum: 50_000,
    spent_txo_sum: 0,
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchBitcoinBalance", () => {
  it("returns confirmed balance in satoshis (funded - spent)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));

    const result = await fetchBitcoinBalance(MOCK_ADDRESS, BASE_URL, false);

    expect(result.layer).toBe("bitcoin");
    expect(result.asset).toBe("BTC");
    expect(result.kind).toBe("native");
    expect(result.balance).toBe(300_000n); // 500_000 - 200_000
    expect(result.decimals).toBe(8);
    expect(result.isBtc).toBe(true);
    expect(result.testnet).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("does not include unconfirmed mempool balance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));

    const result = await fetchBitcoinBalance(MOCK_ADDRESS, BASE_URL, false);
    // mempool_stats are ignored — confirmed only
    expect(result.balance).toBe(300_000n);
  });

  it("returns 0n and error on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));

    const result = await fetchBitcoinBalance(MOCK_ADDRESS, BASE_URL, false);

    expect(result.balance).toBe(0n);
    expect(result.error).toContain("404");
  });

  it("returns 0n and error on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const result = await fetchBitcoinBalance(MOCK_ADDRESS, BASE_URL, false);

    expect(result.balance).toBe(0n);
    expect(result.error).toBe("network error");
  });

  it("sets testnet flag correctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));

    const result = await fetchBitcoinBalance("tb1q...", BASE_URL, true);
    expect(result.testnet).toBe(true);
  });

  it("calls the correct mempool.space endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchBitcoinBalance(MOCK_ADDRESS, BASE_URL, false);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/address/${MOCK_ADDRESS}`,
    );
  });
});
