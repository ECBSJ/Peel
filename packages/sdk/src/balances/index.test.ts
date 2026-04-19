import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchBalances } from "../balances/index.js";
import type { BridIdentityMap } from "@peelbtc/core";

// ---------------------------------------------------------------------------
// Minimal BridIdentityMap fixture
// Addresses are illustrative — real values would come from buildBridIdentityMap()
// ---------------------------------------------------------------------------
const MOCK_IDENTITY: BridIdentityMap = {
  root: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  publicKey: "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc",
  derived: [
    {
      layer: "bitcoin",
      address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      namespace: "bip122" as never,
      format: "p2wpkh",
      testnet: false,
    },
    {
      layer: "stacks",
      address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      namespace: "stacks" as never,
      format: "c32check",
      testnet: false,
    },
    {
      layer: "bob",
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      namespace: "eip155" as never,
      format: "eip55",
      testnet: false,
    },
    {
      layer: "rootstock",
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      namespace: "eip155" as never,
      format: "eip55",
      testnet: false,
    },
    {
      layer: "citrea",
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      namespace: "eip155" as never,
      format: "eip55",
      testnet: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Balances used in the happy-path fixture (all in smallest unit)
//
//   BTC:   300_000 sats           = 0.003 BTC
//   sBTC:  5_000_000 sats         = 0.05 BTC
//   tBTC:  50_000_000_000_000_000 wei  = 0.05 BTC → 5_000_000 sats
//   RBTC:  50_000_000_000_000_000 wei  = 0.05 BTC → 5_000_000 sats
//   cBTC:  30_000_000_000_000_000 wei  = 0.03 BTC → 3_000_000 sats
//   ──────────────────────────────────────────────────────────
//   total: 300_000 + 5_000_000 + 5_000_000 + 5_000_000 + 3_000_000
//        = 18_300_000 sats = 0.183 BTC
// ---------------------------------------------------------------------------

// ⚠️  VERIFY: update SBTC_KEY once Hiro API response format is confirmed
const SBTC_KEY = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sbtc-token::sbtc-token";

function buildMockFetch() {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    // Bitcoin — mempool.space
    if (typeof url === "string" && url.includes("/address/")) {
      return {
        ok: true,
        json: async () => ({
          chain_stats: { funded_txo_sum: 500_000, spent_txo_sum: 200_000 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      };
    }

    // Stacks — Hiro
    if (typeof url === "string" && url.includes("/balances")) {
      return {
        ok: true,
        json: async () => ({
          stx: { balance: "1000000" },
          fungible_tokens: { [SBTC_KEY]: { balance: "5000000" } },
        }),
      };
    }

    // EVM — JSON-RPC
    if (init?.method === "POST") {
      const body = JSON.parse((init.body as string) ?? "{}");
      if (body.method === "eth_getBalance") {
        return { ok: true, json: async () => ({ result: "0xb1a2bc2ec50000" }) };
      }
      if (body.method === "eth_call") {
        return { ok: true, json: async () => ({ result: "0xb1a2bc2ec50000" }) };
      }
    }

    return { ok: false, status: 400, statusText: "Bad Request" };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchBalances (orchestrator)", () => {
  it("returns a BalanceMap with layers and totalBtcSats", async () => {
    vi.stubGlobal("fetch", buildMockFetch());

    const result = await fetchBalances(MOCK_IDENTITY);

    expect(result.layers).toBeDefined();
    expect(result.totalBtcSats).toBeDefined();
    expect(typeof result.fetchedAt).toBe("number");
  });

  it("includes all 6 asset entries (BTC, STX, sBTC, ETH, tBTC, RBTC, cBTC)", async () => {
    vi.stubGlobal("fetch", buildMockFetch());

    const result = await fetchBalances(MOCK_IDENTITY);
    const assets = result.layers.map((l) => l.asset);

    expect(assets).toContain("BTC");
    expect(assets).toContain("STX");
    expect(assets).toContain("sBTC");
    expect(assets).toContain("ETH");
    expect(assets).toContain("tBTC");
    expect(assets).toContain("RBTC");
    expect(assets).toContain("cBTC");
  });

  it("computes totalBtcSats as sum of BTC-denominated assets only", async () => {
    vi.stubGlobal("fetch", buildMockFetch());

    const result = await fetchBalances(MOCK_IDENTITY);

    // BTC: 300_000 sats
    // sBTC: 5_000_000 sats
    // tBTC: 50_000_000_000_000_000 wei / 10^10 = 5_000_000 sats
    // RBTC: 50_000_000_000_000_000 wei / 10^10 = 5_000_000 sats
    // cBTC: 50_000_000_000_000_000 wei / 10^10 = 5_000_000 sats
    // STX + ETH: excluded (isBtc = false)
    const expected = 300_000n + 5_000_000n + 5_000_000n + 5_000_000n + 5_000_000n;
    expect(result.totalBtcSats).toBe(expected); // 20_300_000n
  });

  it("excludes STX and ETH from totalBtcSats", async () => {
    vi.stubGlobal("fetch", buildMockFetch());

    const result = await fetchBalances(MOCK_IDENTITY);
    const nonBtc = result.layers.filter((l) => !l.isBtc);

    expect(nonBtc.map((l) => l.asset)).toEqual(expect.arrayContaining(["STX", "ETH"]));
    // Verify they don't appear in the sum by checking isBtc flags
    for (const entry of nonBtc) {
      expect(entry.isBtc).toBe(false);
    }
  });

  it("tolerates a single layer failure — others succeed and contribute to total", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      // Fail Bitcoin only
      if (typeof url === "string" && url.includes("/address/")) {
        throw new Error("Bitcoin node down");
      }
      // Stacks
      if (typeof url === "string" && url.includes("/balances")) {
        return {
          ok: true,
          json: async () => ({
            stx: { balance: "1000000" },
            fungible_tokens: { [SBTC_KEY]: { balance: "5000000" } },
          }),
        };
      }
      // EVM
      if (init?.method === "POST") {
        const body = JSON.parse((init.body as string) ?? "{}");
        if (body.method === "eth_getBalance") {
          return { ok: true, json: async () => ({ result: "0xb1a2bc2ec50000" }) };
        }
        if (body.method === "eth_call") {
          return { ok: true, json: async () => ({ result: "0xb1a2bc2ec50000" }) };
        }
      }
      return { ok: false, status: 400, statusText: "Bad Request" };
    }));

    const result = await fetchBalances(MOCK_IDENTITY);

    const btcEntry = result.layers.find((l) => l.layer === "bitcoin");
    expect(btcEntry?.error).toBeDefined();
    expect(btcEntry?.balance).toBe(0n);

    // Other BTC-denominated assets still contribute
    expect(result.totalBtcSats).toBeGreaterThan(0n);
  });

  it("uses provided RPC overrides instead of registry URLs", async () => {
    const fetchMock = buildMockFetch();
    vi.stubGlobal("fetch", fetchMock);

    const customBitcoinUrl = "https://my-mempool-node.example.com/api";
    await fetchBalances(MOCK_IDENTITY, { bitcoin: customBitcoinUrl });

    const urls = fetchMock.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((u: unknown) => typeof u === "string");

    expect(urls.some((u: string) => u.startsWith(customBitcoinUrl))).toBe(true);
  });
});
