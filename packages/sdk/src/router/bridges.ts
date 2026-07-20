// ---------------------------------------------------------------------------
// Bridge selection matrix + route step construction
//
// Supported bridge routes (v1):
//   bitcoin  → stacks     : sbtc (peg-in)
//   bitcoin  → rootstock  : flyover (peg-in)
//   bitcoin  → bob        : bob-gateway (peg-in)
//   stacks   → bitcoin    : sbtc (peg-out)
//   bitcoin  → citrea     : ❌ no programmable bridge
//   citrea   ↔ anything   : direct only (no programmable bridge)
//   L2       → L2         : ❌ not supported in v1 (would require 2 hops)
// ---------------------------------------------------------------------------

import type {
  NetworkLayer,
  BridgeName,
  CandidateRoute,
  RouteStep,
  BtcSendStep,
  EvmTransferStep,
  StacksTransferStep,
  BridgeDepositStep,
  BridgeNotifyStep,
  SbtcWithdrawalStep,
  EncodedMemo,
} from "./types.js";
import type { BalanceMap, LayerBalance } from "@peelbtc/types";
import { bridgeFeeEstimate, bridgeTimeEstimate, directTimeEstimate } from "./fees.js";

// ---------------------------------------------------------------------------
// Bridge matrix
// ---------------------------------------------------------------------------

/** Returns the bridge for a source→destination pair, or null if not supported. */
export function selectBridge(
  source: NetworkLayer,
  destination: NetworkLayer,
): BridgeName | null {
  if (source === destination) return null;

  if (source === "bitcoin") {
    if (destination === "stacks")    return "sbtc";
    if (destination === "rootstock") return "flyover";
    if (destination === "bob")       return "bob-gateway";
    return null; // citrea and other L2s have no programmable bridge
  }

  if (source === "stacks" && destination === "bitcoin") return "sbtc";
  // Flyover peg-out (rootstock → bitcoin) deferred: requires active RSK signer
  // BOB Gateway peg-out deferred: CLI-only
  // All L2 → L2: not supported in v1

  return null;
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

/**
 * Generate all viable candidate routes given sender balances and a resolved
 * destination. Filters out bridge-less routes where no bridge exists.
 */
export function buildCandidates(
  senderBalances: BalanceMap,
  destination: { layer: string; possibleChains?: string[] },
  amountSats: bigint,
): CandidateRoute[] {
  const candidates: CandidateRoute[] = [];

  const destLayers: NetworkLayer[] =
    destination.layer === "evm"
      ? ((destination.possibleChains ?? ["bob", "rootstock", "citrea"]) as NetworkLayer[])
      : [destination.layer as NetworkLayer];

  // Build candidates from each asset the sender holds
  for (const balance of senderBalances.layers) {
    if (!balance.isBtc) continue;
    if (balance.error) continue;

    const sourceLayer = balance.layer as NetworkLayer;

    for (const destLayer of destLayers) {
      if (sourceLayer === destLayer) {
        // Direct transfer — always viable (if sender has balance)
        if (balance.balance >= amountSats) {
          candidates.push(directCandidate(sourceLayer, balance));
        }
      } else {
        const bridge = selectBridge(sourceLayer, destLayer);
        if (!bridge) continue;

        // For peg-in from Bitcoin, sender needs BTC balance
        // For peg-out from L2, sender needs the L2 BTC asset
        if (balance.balance >= amountSats) {
          candidates.push(bridgeCandidate(sourceLayer, destLayer, bridge, balance, amountSats));
        }
      }
    }
  }

  return candidates;
}

function directCandidate(layer: NetworkLayer, balance: LayerBalance): CandidateRoute {
  return {
    sourceLayer: layer,
    destinationLayer: layer,
    bridge: undefined,
    sourceAsset: balance.asset,
    destinationAsset: balance.asset,
    senderBalanceSats: balance.balance,
    estimatedFeeSats: 0n, // filled in by fee fetcher
    estimatedTimeSecs: directTimeEstimate(layer),
  };
}

function bridgeCandidate(
  source: NetworkLayer,
  dest: NetworkLayer,
  bridge: BridgeName,
  balance: LayerBalance,
  amountSats: bigint,
): CandidateRoute {
  const bridgeKey = bridge === "sbtc" && source !== "bitcoin" ? "sbtc-out" : bridge;
  return {
    sourceLayer: source,
    destinationLayer: dest,
    bridge,
    sourceAsset: balance.asset,
    destinationAsset: destinationAsset(dest),
    senderBalanceSats: balance.balance,
    estimatedFeeSats: bridgeFeeEstimate(bridgeKey as "flyover" | "sbtc" | "bob-gateway" | "sbtc-out", amountSats),
    estimatedTimeSecs: bridgeTimeEstimate(bridgeKey as "flyover" | "sbtc" | "bob-gateway" | "sbtc-out"),
  };
}

function destinationAsset(layer: NetworkLayer): string {
  switch (layer) {
    case "bitcoin":   return "BTC";
    case "stacks":    return "sBTC";
    case "bob":       return "ETH";
    case "rootstock": return "RBTC";
    case "citrea":    return "cBTC";
  }
}

// ---------------------------------------------------------------------------
// Step construction
// ---------------------------------------------------------------------------

/** Build ordered execution steps from a winning candidate. */
export function buildSteps(
  candidate: CandidateRoute,
  opts: {
    senderAddress: string;
    senderPublicKey: string;
    destinationAddress: string;
    amountSats: bigint;
    memo: EncodedMemo;
  },
): RouteStep[] {
  const { senderAddress, senderPublicKey, destinationAddress, amountSats, memo } = opts;
  const SATS_TO_WEI = 10_000_000_000n;

  // Direct transfers
  if (!candidate.bridge) {
    switch (candidate.sourceLayer) {
      case "bitcoin":
        return [btcSendStep(senderAddress, destinationAddress, amountSats, memo)];

      case "stacks":
        return [stacksStep(
          senderAddress, senderPublicKey, destinationAddress,
          candidate.sourceAsset as "STX" | "sBTC", amountSats, memo,
        )];

      case "bob":
      case "rootstock":
      case "citrea":
        return [evmStep(
          candidate.sourceLayer, senderAddress, destinationAddress,
          amountSats * SATS_TO_WEI,
          candidate.sourceAsset as "ETH" | "RBTC" | "cBTC",
          memo,
        )];
    }
  }

  // Bridge routes
  switch (candidate.bridge) {
    case "sbtc":
      if (candidate.sourceLayer === "bitcoin") {
        // Peg-in
        return [
          sbtcDepositStep(senderAddress, senderPublicKey, destinationAddress, amountSats, candidate, memo),
          sbtcNotifyStep(),
        ];
      } else {
        // Peg-out (stacks → bitcoin)
        return [sbtcWithdrawalStep(senderAddress, senderPublicKey, destinationAddress, amountSats)];
      }

    case "flyover":
      return [flyoverDepositStep(senderAddress, destinationAddress, amountSats, candidate, memo)];

    case "bob-gateway":
      return [bobGatewayStep(senderAddress, destinationAddress, amountSats, candidate, memo)];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

function btcSendStep(
  from: string, to: string, amountSats: bigint, memo: EncodedMemo,
): BtcSendStep {
  return { type: "btc-send", from, to, amountSats, peelMemo: memo };
}

function evmStep(
  chain: "bob" | "rootstock" | "citrea",
  from: string, to: string,
  amountWei: bigint,
  asset: "ETH" | "RBTC" | "cBTC",
  memo: EncodedMemo,
): EvmTransferStep {
  return { type: "evm-transfer", chain, from, to, amountWei, asset, peelMemo: memo };
}

function stacksStep(
  from: string, publicKey: string, to: string,
  asset: "STX" | "sBTC",
  amountSats: bigint,
  memo: EncodedMemo,
): StacksTransferStep {
  return {
    type: "stacks-transfer",
    from, to, publicKey, asset, amountSats,
    // Both STX and sBTC transfers now support memo embedding:
    // STX: native Stacks memo field (34-byte limit)
    // sBTC: SIP-010 transfer(amount, sender, recipient, memo) optional buff param
    peelMemo: memo,
  };
}

function sbtcDepositStep(
  senderBtcAddress: string,
  senderPublicKey: string,
  stacksRecipient: string,
  amountSats: bigint,
  candidate: CandidateRoute,
  memo: EncodedMemo,
): BridgeDepositStep {
  // reclaimPublicKey = strip 02/03 prefix from compressed pubkey
  const reclaimPublicKey = senderPublicKey.startsWith("02") || senderPublicKey.startsWith("03")
    ? senderPublicKey.slice(2)
    : senderPublicKey;

  return {
    type: "bridge-deposit",
    bridge: "sbtc",
    from: senderBtcAddress,
    amountSats,
    estimatedFeeSats: candidate.estimatedFeeSats,
    estimatedTimeSecs: candidate.estimatedTimeSecs,
    params: {
      bridge: "sbtc",
      stacksAddress: stacksRecipient,
      reclaimPublicKey,
      amountSats,
    },
    peelMemo: memo,
  };
}

function sbtcNotifyStep(): BridgeNotifyStep {
  return { type: "bridge-notify", bridge: "sbtc" };
}

function sbtcWithdrawalStep(
  from: string, publicKey: string, btcRecipient: string, amountSats: bigint,
): SbtcWithdrawalStep {
  return {
    type: "sbtc-withdrawal",
    from, publicKey, btcRecipient, amountSats,
    maxFeeSats: 3_000n,
  };
}

function flyoverDepositStep(
  _senderBtcAddress: string,
  recipientRskAddress: string,
  amountSats: bigint,
  candidate: CandidateRoute,
  memo: EncodedMemo,
): BridgeDepositStep {
  return {
    type: "bridge-deposit",
    bridge: "flyover",
    from: _senderBtcAddress,
    amountSats,
    estimatedFeeSats: candidate.estimatedFeeSats,
    estimatedTimeSecs: candidate.estimatedTimeSecs,
    params: { bridge: "flyover", recipientRskAddress, amountSats },
    peelMemo: memo,
  };
}

function bobGatewayStep(
  senderBtcAddress: string,
  recipientBobAddress: string,
  amountSats: bigint,
  candidate: CandidateRoute,
  memo: EncodedMemo,
): BridgeDepositStep {
  return {
    type: "bridge-deposit",
    bridge: "bob-gateway",
    from: senderBtcAddress,
    amountSats,
    estimatedFeeSats: candidate.estimatedFeeSats,
    estimatedTimeSecs: candidate.estimatedTimeSecs,
    params: { bridge: "bob-gateway", recipientBobAddress, amountSats },
    peelMemo: memo,
  };
}
