// ---------------------------------------------------------------------------
// routePayment — Peel routing engine entry point
//
// Given a RouteIntent, returns a RoutePlan: an ordered list of self-contained
// steps the agent executes using the appropriate SDK functions.
//
// Pipeline:
//   1. Fetch sender balances + resolve destination address (parallel)
//   2. Build candidate routes
//   3. Check liveness of all chains in play (parallel)
//   4. Eliminate dead-chain candidates
//   5. Fetch fee estimates for live chains (parallel)
//   6. Fetch receiver activity heuristic for 0x... EVM destinations (parallel)
//   7. Score + rank candidates
//   8. Encode Peel memo with intentId
//   9. Build ordered execution steps from winning candidate
//  10. Fire onIntentResolved callback (opt-in)
// ---------------------------------------------------------------------------

import { fetchBalances } from "../balances/index.js";
import { checkLiveness } from "./liveness.js";
import { fetchFeeEstimates } from "./fees.js";
import { resolveDestination, senderAddressFor } from "./resolve.js";
import { buildCandidates } from "./bridges.js";
import { scoreCandidates } from "./score.js";
import { encodePeelMemo, newIntentId } from "./memo.js";
import { buildSteps } from "./bridges.js";
import type {
  RouteIntent,
  RoutePlan,
  ResolvedIntent,
  NetworkLayer,
  RecipientHint,
} from "./types.js";
import { DEFAULT_SCORE_WEIGHTS as DEFAULTS } from "./types.js";
import type { LayerBalance } from "@peelbtc/types";

/**
 * Resolve the best payment route for the given intent and return a plan.
 * The engine never executes anything — it returns steps for the agent to follow.
 *
 * @throws If no viable route can be found after applying hard constraints.
 */
export async function routePayment(intent: RouteIntent): Promise<RoutePlan> {
  const intentId = newIntentId();
  const weights = { ...DEFAULTS, ...intent.scoreWeights };
  const isTestnet = intent.from.derived.some(d => d.testnet);

  // 1. Resolve destination address + fetch sender balances in parallel
  const destination = resolveDestination(intent.to);
  const senderBalances = await fetchBalances(intent.from);

  // 2. Build candidate routes from sender's holdings
  const candidates = buildCandidates(senderBalances, destination, intent.amountSats);

  if (candidates.length === 0) {
    throw new Error(
      "no viable routes: sender has insufficient balance on any chain that can reach the destination",
    );
  }

  // 3. Collect all chains involved in any candidate
  const chainsInPlay = unique([
    ...candidates.map(c => c.sourceLayer),
    ...candidates.map(c => c.destinationLayer),
  ]) as NetworkLayer[];

  // 4–6. Liveness checks, fee estimates, receiver heuristic — all in parallel
  const [livenessResults, feeMap, receiverData] = await Promise.all([
    checkLiveness(chainsInPlay),
    fetchFeeEstimates(chainsInPlay),
    destination.layer === "evm"
      ? fetchRecipientHint(destination.address, isTestnet)
      : Promise.resolve(undefined),
  ]);

  // 5. Apply live fee estimates to candidates
  const candidatesWithFees = candidates.map(c => {
    const directFee = feeMap.get(c.sourceLayer)?.feeSats ?? 0n;
    return {
      ...c,
      // Bridge candidates already have fee from bridgeFeeEstimate().
      // Direct candidates get the live fee.
      estimatedFeeSats: c.bridge ? c.estimatedFeeSats : directFee,
    };
  });

  // 6. Eliminate candidates on dead chains
  const deadChains = new Set(
    livenessResults.filter(r => !r.alive).map(r => r.layer),
  );
  const liveCandidates = candidatesWithFees.filter(
    c => !deadChains.has(c.sourceLayer) && !deadChains.has(c.destinationLayer),
  );

  if (liveCandidates.length === 0) {
    const dead = [...deadChains].join(", ");
    throw new Error(`no viable routes: all candidate chains are unreachable (${dead})`);
  }

  // 7. Apply destinationChain override for EVM disambiguation
  const filteredCandidates = intent.destinationChain
    ? liveCandidates.filter(c => c.destinationLayer === intent.destinationChain)
    : liveCandidates;

  if (filteredCandidates.length === 0) {
    throw new Error(
      `no route available to destinationChain "${intent.destinationChain}"`,
    );
  }

  // 8. Score + rank
  const scored = scoreCandidates(filteredCandidates, {
    receiverHint: receiverData,
    receiverBalances: receiverData ? await fetchReceiverBalances(destination.address, isTestnet) : undefined,
    weights,
    maxBridgeFeeSats: intent.maxBridgeFeeSats,
    maxTimeSecs: intent.maxTimeSecs,
  });

  if (scored.length === 0) {
    throw new Error(
      "no route satisfies the constraints (maxBridgeFeeSats / maxTimeSecs too restrictive)",
    );
  }

  // Apply preferredBridge override if specified
  const winner =
    intent.preferredBridge
      ? (scored.find(c => c.bridge === intent.preferredBridge) ?? scored[0])
      : scored[0];

  // 9. Encode Peel memo
  const memo = encodePeelMemo(intentId, intent.memo);

  // 10. Get sender addresses
  const senderAddress = senderAddressFor(intent.from.derived, winner.sourceLayer, isTestnet)
    ?? (() => { throw new Error(`sender has no address on ${winner.sourceLayer}`); })();

  // 11. Build execution steps
  const steps = buildSteps(winner, {
    senderAddress,
    senderPublicKey: intent.from.publicKey,
    destinationAddress: intent.to,
    amountSats: intent.amountSats,
    memo,
  });

  // 12. Assemble resolved intent
  const resolvedIntent: ResolvedIntent = {
    id: intentId,
    resolvedAt: Date.now(),
    sourceLayer: winner.sourceLayer,
    destinationLayer: winner.destinationLayer,
    destinationAddress: intent.to,
    amountSats: intent.amountSats,
    route: winner.bridge ? "bridge" : "direct",
    bridge: winner.bridge,
    estimatedFeeSats: winner.estimatedFeeSats,
    estimatedTimeSecs: winner.estimatedTimeSecs,
    networkChecks: livenessResults,
    recipientHint: receiverData,
    allCandidates: scored,
  };

  // 13. Fire opt-in reporter
  if (intent.onIntentResolved) {
    await intent.onIntentResolved(resolvedIntent);
  }

  return { intent: resolvedIntent, steps };
}

// ---------------------------------------------------------------------------
// Receiver heuristic helpers
// ---------------------------------------------------------------------------

/**
 * Fetch BTC balances for a 0x... address on all three EVM chains to determine
 * which the recipient is most active on.
 */
async function fetchRecipientHint(
  evmAddress: string,
  _testnet: boolean,
): Promise<RecipientHint> {
  const { fetchBobBalances } = await import("../balances/bob.js");
  const { fetchRootstockBalance } = await import("../balances/rootstock.js");
  const { fetchCitreaBalance } = await import("../balances/citrea.js");
  const { bob: bobChain, rootstock: rootstockChain, citrea: citreaChain } = await import("viem/chains");

  const [bobResults, rootstock, citrea] = await Promise.all([
    fetchBobBalances(evmAddress as `0x${string}`, false).catch(() => null),
    fetchRootstockBalance(evmAddress, rootstockChain.rpcUrls.default.http[0], false).catch(() => null),
    fetchCitreaBalance(evmAddress, citreaChain.rpcUrls.default.http[0], false).catch(() => null),
  ]);

  const bobEth = Array.isArray(bobResults) ? bobResults.find(b => b.isBtc) : null;

  const entries: Array<{ layer: "bob" | "rootstock" | "citrea"; sats: bigint }> = [
    { layer: "bob",       sats: bobEth?.balance      ?? 0n },
    { layer: "rootstock", sats: rootstock?.balance   ?? 0n },
    { layer: "citrea",    sats: citrea?.balance      ?? 0n },
  ];

  entries.sort((a, b) => (b.sats > a.sats ? 1 : b.sats < a.sats ? -1 : 0));

  const activeLayers = entries.filter(e => e.sats > 0n).map(e => e.layer);
  const preferredEvm = activeLayers[0] ?? null;

  return { activeLayers, preferredEvm };
}

async function fetchReceiverBalances(
  evmAddress: string,
  _testnet: boolean,
): Promise<LayerBalance[]> {
  const { fetchBobBalances } = await import("../balances/bob.js");
  const { fetchRootstockBalance } = await import("../balances/rootstock.js");
  const { fetchCitreaBalance } = await import("../balances/citrea.js");
  const { bob: bobChain, rootstock: rootstockChain, citrea: citreaChain } = await import("viem/chains");

  const [bobResults, rootstock, citrea] = await Promise.all([
    fetchBobBalances(evmAddress as `0x${string}`, false).catch(() => [] as LayerBalance[]),
    fetchRootstockBalance(evmAddress, rootstockChain.rpcUrls.default.http[0], false).catch(() => null),
    fetchCitreaBalance(evmAddress, citreaChain.rpcUrls.default.http[0], false).catch(() => null),
  ]);

  return [
    ...(Array.isArray(bobResults) ? bobResults.filter(b => b.isBtc) : []),
    ...(rootstock ? [rootstock] : []),
    ...(citrea ? [citrea] : []),
  ];
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
