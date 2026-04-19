import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchStacksBalances } from "../balances/stacks.js";
import { SBTC } from "../balances/contracts.js";

const BASE_URL = "https://api.hiro.so";
const MOCK_ADDRESS = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

// ⚠️  VERIFY: confirm the exact key format Hiro uses for sBTC in fungible_tokens
// This test assumes: "{contractAddress}.{contractName}::sbtc-token"
const SBTC_KEY = `${SBTC.mainnet}::sbtc-token`;

const MOCK_RESPONSE = {
  stx: {
    balance: "1000000", // 1 STX = 1,000,000 microSTX
  },
  fungible_tokens: {
    [SBTC_KEY]: {
      balance: "5000000", // 0.05 sBTC = 5,000,000 satoshis
    },
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchStacksBalances", () => {
  it("returns two entries: STX and sBTC", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));

    const results = await fetchStacksBalances(MOCK_ADDRESS, BASE_URL, false);

    expect(results).toHaveLength(2);
    const stx = results.find((r) => r.asset === "STX")!;
    const sbtc = results.find((r) => r.asset === "sBTC")!;
    expect(stx).toBeDefined();
    expect(sbtc).toBeDefined();
  });

  it("STX entry: correct balance, decimals, isBtc=false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));

    const results = await fetchStacksBalances(MOCK_ADDRESS, BASE_URL, false);
    const stx = results.find((r) => r.asset === "STX")!;

    expect(stx.balance).toBe(1_000_000n);
    expect(stx.decimals).toBe(6);
    expect(stx.isBtc).toBe(false);
    expect(stx.kind).toBe("native");
    expect(stx.layer).toBe("stacks");
    expect(stx.error).toBeUndefined();
  });

  it("sBTC entry: correct balance, decimals, isBtc=true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));

    const results = await fetchStacksBalances(MOCK_ADDRESS, BASE_URL, false);
    const sbtc = results.find((r) => r.asset === "sBTC")!;

    expect(sbtc.balance).toBe(5_000_000n);
    expect(sbtc.decimals).toBe(8);
    expect(sbtc.isBtc).toBe(true);
    expect(sbtc.kind).toBe("token");
    expect(sbtc.error).toBeUndefined();
  });

  it("sBTC balance is 0n when token key is absent (no sBTC held)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stx: { balance: "1000000" }, fungible_tokens: {} }),
    }));

    const results = await fetchStacksBalances(MOCK_ADDRESS, BASE_URL, false);
    const sbtc = results.find((r) => r.asset === "sBTC")!;

    expect(sbtc.balance).toBe(0n);
    expect(sbtc.error).toBeUndefined();
  });

  it("returns errors on both entries on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    const results = await fetchStacksBalances(MOCK_ADDRESS, BASE_URL, false);

    for (const r of results) {
      expect(r.balance).toBe(0n);
      expect(r.error).toContain("500");
    }
  });

  it("returns errors on both entries on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    const results = await fetchStacksBalances(MOCK_ADDRESS, BASE_URL, false);

    for (const r of results) {
      expect(r.balance).toBe(0n);
      expect(r.error).toBe("timeout");
    }
  });

  it("calls the correct Hiro API endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchStacksBalances(MOCK_ADDRESS, BASE_URL, false);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/extended/v1/address/${MOCK_ADDRESS}/balances`,
    );
  });
});
