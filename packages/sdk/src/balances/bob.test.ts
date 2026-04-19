import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchBobBalances } from "../balances/bob.js";
import { TBTC_BOB, BALANCE_OF_SELECTOR } from "../balances/contracts.js";

const RPC_URL = "https://rpc.gobob.xyz";
const MOCK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// eth_getBalance response: 0.1 ETH in wei
const ETH_WEI_HEX = "0x16345785d8a0000"; // 100_000_000_000_000_000n

// tBTC balanceOf response: 0.05 tBTC in wei
const TBTC_WEI_HEX = "0xb1a2bc2ec50000"; // 50_000_000_000_000_000n

function mockFetch(ethHex: string, tbtcHex: string) {
  let callCount = 0;
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    if (body.method === "eth_getBalance") {
      return { ok: true, json: async () => ({ result: ethHex }) };
    }
    if (body.method === "eth_call") {
      return { ok: true, json: async () => ({ result: tbtcHex }) };
    }
    callCount++;
    return { ok: false, status: 400, statusText: "Bad Request" };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchBobBalances", () => {
  it("returns two entries: ETH and tBTC", async () => {
    vi.stubGlobal("fetch", mockFetch(ETH_WEI_HEX, TBTC_WEI_HEX));

    const results = await fetchBobBalances(MOCK_ADDRESS, RPC_URL, false);

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.asset === "ETH")).toBeDefined();
    expect(results.find((r) => r.asset === "tBTC")).toBeDefined();
  });

  it("ETH entry: correct balance, decimals, isBtc=false", async () => {
    vi.stubGlobal("fetch", mockFetch(ETH_WEI_HEX, TBTC_WEI_HEX));

    const results = await fetchBobBalances(MOCK_ADDRESS, RPC_URL, false);
    const eth = results.find((r) => r.asset === "ETH")!;

    expect(eth.balance).toBe(100_000_000_000_000_000n);
    expect(eth.decimals).toBe(18);
    expect(eth.isBtc).toBe(false);
    expect(eth.kind).toBe("native");
    expect(eth.layer).toBe("bob");
    expect(eth.error).toBeUndefined();
  });

  it("tBTC entry: correct balance, decimals, isBtc=true", async () => {
    vi.stubGlobal("fetch", mockFetch(ETH_WEI_HEX, TBTC_WEI_HEX));

    const results = await fetchBobBalances(MOCK_ADDRESS, RPC_URL, false);
    const tbtc = results.find((r) => r.asset === "tBTC")!;

    expect(tbtc.balance).toBe(50_000_000_000_000_000n);
    expect(tbtc.decimals).toBe(18);
    expect(tbtc.isBtc).toBe(true);
    expect(tbtc.kind).toBe("token");
    expect(tbtc.error).toBeUndefined();
  });

  it("encodes balanceOf call data correctly", async () => {
    const fetchMock = mockFetch(ETH_WEI_HEX, TBTC_WEI_HEX);
    vi.stubGlobal("fetch", fetchMock);

    await fetchBobBalances(MOCK_ADDRESS, RPC_URL, false);

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const ethCallRequest = calls.find((c) => {
      const body = JSON.parse(c[1]?.body as string);
      return body.method === "eth_call";
    });

    expect(ethCallRequest).toBeDefined();
    const body = JSON.parse(ethCallRequest![1].body as string);
    // data = BALANCE_OF_SELECTOR + address zero-padded to 32 bytes
    expect(body.params[0].data).toMatch(new RegExp(`^${BALANCE_OF_SELECTOR}`));
    expect(body.params[0].to).toBe(TBTC_BOB.mainnet);
  });

  it("uses testnet tBTC contract when testnet=true", async () => {
    const fetchMock = mockFetch(ETH_WEI_HEX, TBTC_WEI_HEX);
    vi.stubGlobal("fetch", fetchMock);

    await fetchBobBalances(MOCK_ADDRESS, RPC_URL, true);

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const ethCallRequest = calls.find((c) => {
      const body = JSON.parse(c[1]?.body as string);
      return body.method === "eth_call";
    });
    const body = JSON.parse(ethCallRequest![1].body as string);
    expect(body.params[0].to).toBe(TBTC_BOB.testnet);
  });

  it("isolates ETH error from tBTC — tBTC can still succeed", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.method === "eth_getBalance") {
        return { ok: false, status: 503, statusText: "Service Unavailable" };
      }
      return { ok: true, json: async () => ({ result: TBTC_WEI_HEX }) };
    }));

    const results = await fetchBobBalances(MOCK_ADDRESS, RPC_URL, false);
    const eth = results.find((r) => r.asset === "ETH")!;
    const tbtc = results.find((r) => r.asset === "tBTC")!;

    expect(eth.balance).toBe(0n);
    expect(eth.error).toContain("503");
    expect(tbtc.balance).toBe(50_000_000_000_000_000n);
    expect(tbtc.error).toBeUndefined();
  });
});
