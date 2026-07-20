// ---------------------------------------------------------------------------
// Candidate scoring
//
// Each candidate route is scored 0–100 using four weighted signals:
//
//   senderBalance   (default 35) — prefer routes that spend the sender's
//                                  most liquid BTC asset (minimise bridging)
//   receiverActivity (default 25) — prefer chains where the receiver has
//                                   most BTC holdings (most likely to be useful)
//   feeRate          (default 25) — lower total fee = higher score
//   settlementTime   (default 15) — faster settlement = higher score
//
// Scores are normalised within the candidate set so they are always relative.
// ---------------------------------------------------------------------------

import type {
  CandidateRoute,
  ScoredCandidate,
  ScoreWeights,
  RecipientHint,
} from "./types.js";
import type { LayerBalance } from "@peelbtc/types";

/**
 * Score all candidates and return them sorted highest-first.
 * Also filters out candidates that violate hard constraints.
 */
export function scoreCandidates(
  candidates: CandidateRoute[],
  opts: {
    receiverHint?: RecipientHint;
    receiverBalances?: LayerBalance[];
    weights: ScoreWeights;
    maxBridgeFeeSats?: bigint;
    maxTimeSecs?: number;
  },
): ScoredCandidate[] {
  const { receiverHint, receiverBalances, weights, maxBridgeFeeSats, maxTimeSecs } = opts;

  // Hard constraint filtering
  const viable = candidates.filter(c => {
    if (maxBridgeFeeSats !== undefined && c.bridge && c.estimatedFeeSats > maxBridgeFeeSats) {
      return false;
    }
    if (maxTimeSecs !== undefined && c.estimatedTimeSecs > maxTimeSecs) {
      return false;
    }
    return true;
  });

  if (viable.length === 0) return [];

  // Pre-compute range values for normalisation
  const maxFee = viable.reduce((m, c) => c.estimatedFeeSats > m ? c.estimatedFeeSats : m, 0n);
  const maxTime = viable.reduce((m, c) => c.estimatedTimeSecs > m ? c.estimatedTimeSecs : m, 0);
  const totalSenderBtcSats = viable.reduce((s, c) => s + c.senderBalanceSats, 0n);

  const totalReceiverSats = receiverBalances
    ?.filter(b => b.isBtc)
    .reduce((s, b) => s + b.balance, 0n) ?? 0n;

  const scored: ScoredCandidate[] = viable.map(c => {
    // 1. Sender balance score — higher own balance = higher score
    const senderScore = totalSenderBtcSats > 0n
      ? Number((c.senderBalanceSats * 100n) / totalSenderBtcSats)
      : 50;

    // 2. Receiver activity score — prefer destination where receiver is most active
    const receiverScore = computeReceiverScore(
      c.destinationLayer as string,
      receiverHint,
      receiverBalances,
      totalReceiverSats,
    );

    // 3. Fee rate score — lower fee = higher score (inverted, normalised)
    const feeScore = maxFee > 0n
      ? Number(((maxFee - c.estimatedFeeSats) * 100n) / maxFee)
      : 100;

    // 4. Settlement time score — faster = higher score (inverted, normalised)
    const timeScore = maxTime > 0
      ? Math.round(((maxTime - c.estimatedTimeSecs) / maxTime) * 100)
      : 100;

    const totalWeight = weights.senderBalance + weights.receiverActivity +
                        weights.feeRate + weights.settlementTime;

    const score = (
      senderScore    * weights.senderBalance   +
      receiverScore  * weights.receiverActivity +
      feeScore       * weights.feeRate          +
      timeScore      * weights.settlementTime
    ) / totalWeight;

    return {
      ...c,
      score: Math.round(score),
      scoreBreakdown: {
        senderBalance:    Math.round(senderScore),
        receiverActivity: Math.round(receiverScore),
        feeRate:          Math.round(feeScore),
        settlementTime:   Math.round(timeScore),
      },
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

function computeReceiverScore(
  destinationLayer: string,
  receiverHint?: RecipientHint,
  receiverBalances?: LayerBalance[],
  totalReceiverSats?: bigint,
): number {
  if (!receiverBalances || !totalReceiverSats || totalReceiverSats === 0n) {
    // No receiver data — use the hint if available, otherwise neutral
    if (receiverHint?.preferredEvm === destinationLayer) return 80;
    if (receiverHint?.activeLayers.includes(destinationLayer as "bob" | "rootstock" | "citrea")) return 60;
    return 50;
  }

  const layerBalance = receiverBalances
    .filter(b => b.isBtc && b.layer === destinationLayer)
    .reduce((s, b) => s + b.balance, 0n);

  return Number((layerBalance * 100n) / totalReceiverSats);
}
