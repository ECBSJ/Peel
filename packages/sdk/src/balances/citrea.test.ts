import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchCitreaBalance } from "../balances/citrea.js";

const RPC_URL = "https://rpc.devnet.citrea.xyz";
const MOCK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// 0.03 cBTC in wei
const CBTC_WEI_HEX = "0x6a94d74f430000"; // 30_000_000_000_000_000n

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchCitreaBalance", () => {
  it("returns cBTC native balance in wei", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: CBTC_WEI_HEX }),
    }));

    const result = await fetchCitreaBalance(MOCK_ADDRESS, RPC_URL, true);

    expect(result.layer).toBe("citrea");
    expect(result.asset).toBe("cBTC");
    expect(result.kind).toBe("native");
    expect(result.balance).toBe(30_000_000_000_000_000n);
    expect(result.decimals).toBe(18);
    expect(result.isBtc).toBe(true);
    expect(result.testnet).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("converts to satoshis correctly (30_000_000_000_000_000 wei = 3_000_000 sats)", () => {
    // Unit check: wei / 10^10
    const wei = 30_000_000_000_000_000n;
    const sats = wei / 10n ** 10n;
    expect(sats).toBe(3_000_000n); // 0.03 BTC
  });

  it("returns 0n and error on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    }));

    const result = await fetchCitreaBalance(MOCK_ADDRESS, RPC_URL, true);

    expect(result.balance).toBe(0n);
    expect(result.error).toContain("503");
  });

  it("returns 0n and error on RPC error response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { message: "method not found" } }),
    }));

    const result = await fetchCitreaBalance(MOCK_ADDRESS, RPC_URL, true);

    expect(result.balance).toBe(0n);
    expect(result.error).toBe("method not found");
  });

  it("returns 0n and error on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    const result = await fetchCitreaBalance(MOCK_ADDRESS, RPC_URL, true);

    expect(result.balance).toBe(0n);
    expect(result.error).toBe("timeout");
  });

  it("sends correct eth_getBalance JSON-RPC request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: CBTC_WEI_HEX }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchCitreaBalance(MOCK_ADDRESS, RPC_URL, true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RPC_URL);
    const body = JSON.parse(init.body as string);
    expect(body.method).toBe("eth_getBalance");
    expect(body.params[0]).toBe(MOCK_ADDRESS);
    expect(body.params[1]).toBe("latest");
  });
});
