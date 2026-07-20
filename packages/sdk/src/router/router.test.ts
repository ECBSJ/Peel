// ---------------------------------------------------------------------------
// Router unit tests — pure functions, no network calls
//
// Covers:
//   - resolve.ts  : resolveDestination, senderAddressFor
//   - memo.ts     : encodePeelMemo, PEEL_MEMO_MAGIC
//   - bridges.ts  : selectBridge, buildCandidates, buildSteps
//   - score.ts    : scoreCandidates (weighting, constraints, normalization)
//   - fees.ts     : bridgeFeeEstimate, bridgeTimeEstimate, directTimeEstimate
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

// Import directly from source modules (not the barrel) to keep tests focused
import { resolveDestination, senderAddressFor } from "../../src/router/resolve.js";
import {
  encodePeelMemo,
  newIntentId,
  PEEL_MEMO_MAGIC,
  PEEL_MEMO_VERSION,
} from "../../src/router/memo.js";
import { selectBridge, buildCandidates, buildSteps } from "../../src/router/bridges.js";
import { scoreCandidates } from "../../src/router/score.js";
import {
  bridgeFeeEstimate,
  bridgeTimeEstimate,
  directTimeEstimate,
} from "../../src/router/fees.js";
import type { CandidateRoute, EncodedMemo } from "../../src/router/types.js";
import { DEFAULT_SCORE_WEIGHTS } from "../../src/router/types.js";

// ---------------------------------------------------------------------------
// resolve.ts — resolveDestination
// ---------------------------------------------------------------------------

describe("resolveDestination", () => {
  describe("Bitcoin addresses", () => {
    it("resolves P2WPKH mainnet (bc1q...)", () => {
      const r = resolveDestination("bc1qrk3txtstlpdffr3lss4nq3x0rfs7nhcqqpr33k");
      expect(r.layer).toBe("bitcoin");
    });

    it("resolves P2TR mainnet (bc1p...)", () => {
      const r = resolveDestination("bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297");
      expect(r.layer).toBe("bitcoin");
    });

    it("resolves P2PKH mainnet (1...)", () => {
      const r = resolveDestination("1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf");
      expect(r.layer).toBe("bitcoin");
    });

    it("resolves P2SH mainnet (3...)", () => {
      const r = resolveDestination("342ftSRCvFHfCeFFBuz4xwbeqnDw6BGUey");
      expect(r.layer).toBe("bitcoin");
    });

    it("resolves P2WPKH testnet (tb1q...)", () => {
      const r = resolveDestination("tb1qvprq2gqzhj5nqmp8tm598yrs2g32vm0ut2lcge");
      expect(r.layer).toBe("bitcoin");
    });
  });

  describe("Stacks addresses", () => {
    it("resolves mainnet SP address", () => {
      const r = resolveDestination("SPET5CSE1FW5N54E7Y22PC24SWD63TEZ01GAB7A3");
      expect(r.layer).toBe("stacks");
      expect(r.address).toBe("SPET5CSE1FW5N54E7Y22PC24SWD63TEZ01GAB7A3");
    });

    it("resolves testnet ST address", () => {
      const r = resolveDestination("STET5CSE1FW5N54E7Y22PC24SWD63TEZ02ACMV0R");
      expect(r.layer).toBe("stacks");
    });
  });

  describe("EVM addresses", () => {
    it("resolves 0x address and includes all three EVM chains", () => {
      const r = resolveDestination("0x2935C2621F4035Dbbf7BC370384B68e76a37C283");
      expect(r.layer).toBe("evm");
      if (r.layer === "evm") {
        expect(r.possibleChains).toContain("bob");
        expect(r.possibleChains).toContain("rootstock");
        expect(r.possibleChains).toContain("citrea");
        expect(r.possibleChains).toHaveLength(3);
      }
    });

    it("is case-insensitive for 0x addresses", () => {
      const r = resolveDestination("0x2935c2621f4035dbbf7bc370384b68e76a37c283");
      expect(r.layer).toBe("evm");
    });
  });

  describe("invalid addresses", () => {
    it("throws on unrecognised format", () => {
      expect(() => resolveDestination("not-an-address")).toThrow();
    });

    it("throws on empty string", () => {
      expect(() => resolveDestination("")).toThrow();
    });

    it("throws on 0x address with wrong length", () => {
      expect(() => resolveDestination("0x1234")).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// resolve.ts — senderAddressFor
// ---------------------------------------------------------------------------

describe("senderAddressFor", () => {
  const derived = [
    { address: "bc1qrk3tx...", layer: "bitcoin", testnet: false },
    { address: "SPET5CSE...", layer: "stacks",  testnet: false },
    { address: "0x2935C2...", layer: "evm",     testnet: false },
    { address: "tb1q...",     layer: "bitcoin", testnet: true  },
  ];

  it("finds bitcoin mainnet address", () => {
    expect(senderAddressFor(derived, "bitcoin", false)).toBe("bc1qrk3tx...");
  });

  it("finds stacks mainnet address", () => {
    expect(senderAddressFor(derived, "stacks", false)).toBe("SPET5CSE...");
  });

  it("maps evm chains to layer=evm", () => {
    expect(senderAddressFor(derived, "bob", false)).toBe("0x2935C2...");
    expect(senderAddressFor(derived, "rootstock", false)).toBe("0x2935C2...");
    expect(senderAddressFor(derived, "citrea", false)).toBe("0x2935C2...");
  });

  it("respects testnet flag", () => {
    expect(senderAddressFor(derived, "bitcoin", true)).toBe("tb1q...");
    expect(senderAddressFor(derived, "bitcoin", false)).toBe("bc1qrk3tx...");
  });

  it("returns undefined for missing layer", () => {
    expect(senderAddressFor(derived, "stacks", true)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// memo.ts — encodePeelMemo
// ---------------------------------------------------------------------------

describe("encodePeelMemo", () => {
  const UUID = "550e8400-e29b-41d4-a716-446655440000";

  it("starts with PEEL magic bytes", () => {
    const memo = encodePeelMemo(UUID);
    expect(memo.bytes[0]).toBe(0x50); // P
    expect(memo.bytes[1]).toBe(0x45); // E
    expect(memo.bytes[2]).toBe(0x45); // E
    expect(memo.bytes[3]).toBe(0x4c); // L
  });

  it("has version byte 0x01 at index 4", () => {
    const memo = encodePeelMemo(UUID);
    expect(memo.bytes[4]).toBe(PEEL_MEMO_VERSION);
  });

  it("encodes intentId as 16 bytes starting at index 5", () => {
    const memo = encodePeelMemo(UUID);
    // UUID "550e8400-e29b-41d4-a716-446655440000" → 16 bytes
    expect(memo.bytes.length).toBeGreaterThanOrEqual(21); // 4 + 1 + 16
    expect(memo.intentId).toBe(UUID);
  });

  it("produces minimum 21-byte memo with no userMemo", () => {
    const memo = encodePeelMemo(UUID);
    expect(memo.bytes.length).toBe(21);
  });

  it("embeds userMemo up to 13 bytes", () => {
    const memo = encodePeelMemo(UUID, "hello world");
    expect(memo.bytes.length).toBe(21 + "hello world".length);
  });

  it("truncates userMemo to 13 bytes", () => {
    const longMemo = "this is a memo that is definitely too long";
    const memo = encodePeelMemo(UUID, longMemo);
    expect(memo.bytes.length).toBe(34); // max: 4+1+16+13
  });

  it("hex matches bytes", () => {
    const memo = encodePeelMemo(UUID);
    const expected = Array.from(memo.bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    expect(memo.hex).toBe(expected);
  });

  it("starts with '5045454c' in hex (PEEL)", () => {
    const memo = encodePeelMemo(UUID);
    expect(memo.hex.startsWith("5045454c")).toBe(true);
  });

  it("newIntentId returns a valid UUID", () => {
    const id = newIntentId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ---------------------------------------------------------------------------
// bridges.ts — selectBridge
// ---------------------------------------------------------------------------

describe("selectBridge", () => {
  describe("bitcoin peg-in routes", () => {
    it("bitcoin → stacks: sbtc", () => {
      expect(selectBridge("bitcoin", "stacks")).toBe("sbtc");
    });
    it("bitcoin → rootstock: flyover", () => {
      expect(selectBridge("bitcoin", "rootstock")).toBe("flyover");
    });
    it("bitcoin → bob: bob-gateway", () => {
      expect(selectBridge("bitcoin", "bob")).toBe("bob-gateway");
    });
    it("bitcoin → citrea: null (no programmable bridge)", () => {
      expect(selectBridge("bitcoin", "citrea")).toBeNull();
    });
  });

  describe("peg-out routes", () => {
    it("stacks → bitcoin: sbtc", () => {
      expect(selectBridge("stacks", "bitcoin")).toBe("sbtc");
    });
    it("rootstock → bitcoin: null (deferred in v1)", () => {
      expect(selectBridge("rootstock", "bitcoin")).toBeNull();
    });
    it("bob → bitcoin: null (deferred in v1)", () => {
      expect(selectBridge("bob", "bitcoin")).toBeNull();
    });
  });

  describe("direct transfers", () => {
    it("same → same: null", () => {
      expect(selectBridge("bitcoin", "bitcoin")).toBeNull();
      expect(selectBridge("stacks", "stacks")).toBeNull();
      expect(selectBridge("bob", "bob")).toBeNull();
    });
  });

  describe("unsupported cross-L2 routes", () => {
    it("stacks → bob: null", () => {
      expect(selectBridge("stacks", "bob")).toBeNull();
    });
    it("bob → rootstock: null", () => {
      expect(selectBridge("bob", "rootstock")).toBeNull();
    });
    it("rootstock → stacks: null", () => {
      expect(selectBridge("rootstock", "stacks")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// bridges.ts — buildCandidates
// ---------------------------------------------------------------------------

describe("buildCandidates", () => {
  const makeBalance = (layer: string, asset: string, balance: bigint) => ({
    layer, address: "0xtest", asset, kind: "native" as const,
    balance, decimals: 18, isBtc: true, testnet: false,
  });

  const senderBalances = {
    layers: [
      makeBalance("bitcoin", "BTC", 500_000n),
      makeBalance("stacks", "sBTC", 100_000n),
      makeBalance("bob", "ETH", 200_000n),
    ],
    totalBtcSats: 800_000n,
    fetchedAt: Date.now(),
  };

  it("generates direct transfer for same-layer destination", () => {
    const candidates = buildCandidates(
      senderBalances,
      { layer: "bitcoin" },
      100_000n,
    );
    const direct = candidates.find(c => c.sourceLayer === "bitcoin" && !c.bridge);
    expect(direct).toBeDefined();
    expect(direct?.destinationLayer).toBe("bitcoin");
  });

  it("generates bridge candidates for bitcoin → evm", () => {
    const candidates = buildCandidates(
      senderBalances,
      { layer: "evm", possibleChains: ["bob", "rootstock"] },
      100_000n,
    );
    const flyover = candidates.find(c => c.bridge === "flyover");
    const gateway = candidates.find(c => c.bridge === "bob-gateway");
    expect(flyover).toBeDefined();
    expect(gateway).toBeDefined();
  });

  it("does NOT generate citrea bridge candidates (no programmable bridge)", () => {
    const candidates = buildCandidates(
      senderBalances,
      { layer: "evm", possibleChains: ["bob", "rootstock", "citrea"] },
      100_000n,
    );
    const citreiaBridge = candidates.find(
      c => c.destinationLayer === "citrea" && c.bridge,
    );
    expect(citreiaBridge).toBeUndefined();
  });

  it("allows direct transfer to citrea if sender is already on citrea", () => {
    const citreaBalances = {
      ...senderBalances,
      layers: [makeBalance("citrea", "cBTC", 500_000n)],
    };
    const candidates = buildCandidates(
      citreaBalances,
      { layer: "evm", possibleChains: ["citrea"] },
      100_000n,
    );
    const direct = candidates.find(c => c.sourceLayer === "citrea" && !c.bridge);
    expect(direct).toBeDefined();
  });

  it("excludes candidates where sender balance < amountSats", () => {
    const lowBalance = {
      ...senderBalances,
      layers: [makeBalance("bitcoin", "BTC", 50n)],
    };
    const candidates = buildCandidates(lowBalance, { layer: "stacks" }, 100_000n);
    expect(candidates).toHaveLength(0);
  });

  it("generates sBTC peg-out candidate for stacks → bitcoin", () => {
    const candidates = buildCandidates(
      senderBalances,
      { layer: "bitcoin" },
      50_000n,
    );
    const sbtcOut = candidates.find(
      c => c.sourceLayer === "stacks" && c.bridge === "sbtc",
    );
    expect(sbtcOut).toBeDefined();
    expect(sbtcOut?.destinationLayer).toBe("bitcoin");
  });
});

// ---------------------------------------------------------------------------
// score.ts — scoreCandidates
// ---------------------------------------------------------------------------

describe("scoreCandidates", () => {
  const makeCandidate = (
    overrides: Partial<CandidateRoute> = {},
  ): CandidateRoute => ({
    sourceLayer: "bitcoin",
    destinationLayer: "stacks",
    bridge: "sbtc",
    sourceAsset: "BTC",
    destinationAsset: "sBTC",
    senderBalanceSats: 500_000n,
    estimatedFeeSats: 80_000n,
    estimatedTimeSecs: 1200,
    ...overrides,
  });

  it("returns candidates sorted highest score first", () => {
    const cheap = makeCandidate({ estimatedFeeSats: 1_000n });
    const expensive = makeCandidate({ estimatedFeeSats: 100_000n });
    const scored = scoreCandidates([cheap, expensive], {
      weights: DEFAULT_SCORE_WEIGHTS,
    });
    expect(scored[0]).toMatchObject({ estimatedFeeSats: 1_000n });
  });

  it("filters out candidates exceeding maxBridgeFeeSats", () => {
    const expensive = makeCandidate({ bridge: "sbtc", estimatedFeeSats: 200_000n });
    const scored = scoreCandidates([expensive], {
      weights: DEFAULT_SCORE_WEIGHTS,
      maxBridgeFeeSats: 100_000n,
    });
    expect(scored).toHaveLength(0);
  });

  it("does not filter direct transfers by maxBridgeFeeSats", () => {
    const direct = makeCandidate({ bridge: undefined, estimatedFeeSats: 500_000n });
    const scored = scoreCandidates([direct], {
      weights: DEFAULT_SCORE_WEIGHTS,
      maxBridgeFeeSats: 100_000n,
    });
    expect(scored).toHaveLength(1);
  });

  it("filters out candidates exceeding maxTimeSecs", () => {
    const slow = makeCandidate({ estimatedTimeSecs: 7200 });
    const scored = scoreCandidates([slow], {
      weights: DEFAULT_SCORE_WEIGHTS,
      maxTimeSecs: 3600,
    });
    expect(scored).toHaveLength(0);
  });

  it("prefers higher sender balance (spend most liquid asset)", () => {
    const highBalance = makeCandidate({
      sourceLayer: "bitcoin",
      senderBalanceSats: 900_000n,
    });
    const lowBalance = makeCandidate({
      sourceLayer: "stacks",
      senderBalanceSats: 100_000n,
    });
    const scored = scoreCandidates([highBalance, lowBalance], {
      weights: { ...DEFAULT_SCORE_WEIGHTS, senderBalance: 100, feeRate: 0, settlementTime: 0, receiverActivity: 0 },
    });
    expect(scored[0].senderBalanceSats).toBe(900_000n);
  });

  it("prefers lower fee", () => {
    const cheap = makeCandidate({ estimatedFeeSats: 1_000n });
    const expensive = makeCandidate({ estimatedFeeSats: 50_000n });
    const scored = scoreCandidates([cheap, expensive], {
      weights: { ...DEFAULT_SCORE_WEIGHTS, senderBalance: 0, receiverActivity: 0, settlementTime: 0, feeRate: 100 },
    });
    expect(scored[0].estimatedFeeSats).toBe(1_000n);
  });

  it("prefers faster settlement", () => {
    const fast = makeCandidate({ estimatedTimeSecs: 30 });
    const slow = makeCandidate({ estimatedTimeSecs: 3600 });
    const scored = scoreCandidates([fast, slow], {
      weights: { ...DEFAULT_SCORE_WEIGHTS, senderBalance: 0, receiverActivity: 0, feeRate: 0, settlementTime: 100 },
    });
    expect(scored[0].estimatedTimeSecs).toBe(30);
  });

  it("returns empty array for empty input", () => {
    expect(scoreCandidates([], { weights: DEFAULT_SCORE_WEIGHTS })).toHaveLength(0);
  });

  it("score breakdown values are 0–100", () => {
    const scored = scoreCandidates([makeCandidate()], {
      weights: DEFAULT_SCORE_WEIGHTS,
    });
    const bd = scored[0].scoreBreakdown;
    for (const v of Object.values(bd)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// fees.ts — deterministic estimates (no network)
// ---------------------------------------------------------------------------

describe("bridgeFeeEstimate", () => {
  it("sbtc peg-in: returns DEFAULT_MAX_SIGNER_FEE (80_000n)", () => {
    expect(bridgeFeeEstimate("sbtc", 1_000_000n)).toBe(80_000n);
  });

  it("flyover: 0.15% of amount", () => {
    // 1_000_000n * 15 / 10_000 = 1_500n
    expect(bridgeFeeEstimate("flyover", 1_000_000n)).toBe(1_500n);
  });

  it("bob-gateway: fixed estimate", () => {
    expect(bridgeFeeEstimate("bob-gateway", 500_000n)).toBeGreaterThan(0n);
  });

  it("sbtc-out: 3_000n", () => {
    expect(bridgeFeeEstimate("sbtc-out", 500_000n)).toBe(3_000n);
  });
});

describe("bridgeTimeEstimate", () => {
  it("sbtc peg-in: ~20 min", () => {
    expect(bridgeTimeEstimate("sbtc")).toBe(20 * 60);
  });
  it("flyover: ~40 min", () => {
    expect(bridgeTimeEstimate("flyover")).toBe(40 * 60);
  });
  it("bob-gateway: ~20 min", () => {
    expect(bridgeTimeEstimate("bob-gateway")).toBe(20 * 60);
  });
  it("sbtc-out: ~60 min", () => {
    expect(bridgeTimeEstimate("sbtc-out")).toBe(60 * 60);
  });
});

describe("directTimeEstimate", () => {
  it("bitcoin: ~10 min", () => {
    expect(directTimeEstimate("bitcoin")).toBe(10 * 60);
  });
  it("stacks: ~10 seconds", () => {
    expect(directTimeEstimate("stacks")).toBe(10);
  });
  it("bob: ~2 seconds", () => {
    expect(directTimeEstimate("bob")).toBe(2);
  });
  it("rootstock: ~30 seconds", () => {
    expect(directTimeEstimate("rootstock")).toBe(30);
  });
  it("citrea: ~2 seconds", () => {
    expect(directTimeEstimate("citrea")).toBe(2);
  });
});
