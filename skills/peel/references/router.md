# routePayment — Peel Routing Engine Reference

## What it is

`routePayment` is the core Peel abstraction. The caller describes a payment intent
(who, where, how much in sats) and the engine returns a fully resolved execution
plan — an ordered list of steps the agent follows using the existing SDK functions.

The engine never executes anything. It only decides and plans.

```ts
import { routePayment, type RouteIntent, type RoutePlan } from "@peelbtc/sdk";
import { buildBridIdentityMap } from "@peelbtc/core";

const plan = await routePayment({
  from: identity,          // BridIdentityMap — source wallet
  to: "SP1...",            // destination address — any chain, any format
  amountSats: 100_000n,    // always in sats
})

// plan.intent   — the resolved routing decision (scores, chain choices, fees)
// plan.steps[]  — what the agent must execute, in order
```

---

## Resolution pipeline

The engine runs these phases on every call:

1. **Address detection** — determines which chain(s) `to` can belong to
2. **Candidate generation** — enumerates all viable (sourceChain, destChain, bridge) routes given sender balances
3. **Liveness check** — pings all chains in play; dead chains are eliminated
4. **Fee estimation** — fetches live gas/fee data per chain; falls back to defaults
5. **Receiver heuristic** — for `0x...` EVM addresses, checks balances on BOB/Rootstock/Citrea to infer which the receiver uses most
6. **Scoring** — ranks candidates by weighted score (see below)
7. **Step construction** — builds the ordered execution plan from the winning route

---

## Supported routes

| Source | Destination | Route type | Bridge |
|---|---|---|---|
| Any chain | Same chain | Direct transfer | None |
| Bitcoin L1 | Stacks | Bridge | sBTC peg-in |
| Bitcoin L1 | Rootstock | Bridge | Flyover peg-in |
| Bitcoin L1 | BOB | Bridge | BOB Gateway |
| Stacks | Bitcoin L1 | Bridge | sBTC peg-out |
| Any L2 | Different L2 | ❌ Not supported v1 | — |
| Bitcoin L1 | Citrea | ❌ No programmable bridge | — |

Citrea is supported as a **direct transfer destination** (if sender already holds cBTC on Citrea), but there is no programmatic bridge route to Citrea.

---

## Intent options

```ts
const plan = await routePayment({
  from: identity,
  to: "0x...",
  amountSats: 500_000n,

  // — Disambiguation (required for 0x... when you want a specific chain) —
  destinationChain: "rootstock",   // "bob" | "rootstock" | "citrea"

  // — Constraints —
  preferredBridge: "flyover",      // override bridge selection
  maxBridgeFeeSats: 10_000n,       // reject routes costing more than this
  maxTimeSecs: 3600,               // reject routes taking longer than this

  // — Memo —
  memo: "invoice #42",             // embedded alongside Peel marker in the tx

  // — Score weight overrides —
  scoreWeights: {
    senderBalance:    35,          // prefer routes that spend sender's most liquid asset
    receiverActivity: 25,          // prefer chains where receiver is most active
    feeRate:          25,          // prefer cheaper routes
    settlementTime:   15,          // prefer faster routes
  },

  // — Opt-in telemetry —
  onIntentResolved: async (intent) => {
    console.log("route chosen:", intent.route, intent.bridge ?? "direct");
    console.log("estimated fee:", intent.estimatedFeeSats, "sats");
    console.log("estimated time:", intent.estimatedTimeSecs, "seconds");
  },
})
```

---

## Scoring

Each candidate route is scored 0–100. Higher wins. Two hard filters run first:

1. **Liveness** — chains that fail the 5s RPC ping are excluded entirely
2. **Constraints** — candidates violating `maxBridgeFeeSats` or `maxTimeSecs` are excluded

Then four weighted signals:

| Signal | Default weight | Logic |
|---|---|---|
| `senderBalance` | 35 | Sender's balance on source chain ÷ total sender BTC. Prefer spending the most liquid asset. |
| `receiverActivity` | 25 | Receiver's BTC balance on destination chain ÷ total receiver BTC. Prefer the chain they use most. |
| `feeRate` | 25 | Inverted, normalised within candidate set. Lower fee = higher score. |
| `settlementTime` | 15 | Inverted, normalised within candidate set. Faster = higher score. |

**Tie-breaking:** `preferredBridge` picks that bridge's route from the top-scored candidates regardless of score order.

**EVM disambiguation:** For `0x...` destinations without `destinationChain`, the receiver heuristic (live balance check on BOB/Rootstock/Citrea) determines `preferredEvm` which becomes the top candidate if all else is equal.

---

## Execution steps

After `routePayment` returns, the agent executes `plan.steps` in order. Each step is self-contained — it has everything needed to act.

### `btc-send`

Agent builds, signs, and broadcasts a Bitcoin UTXO transaction.

```ts
const step: BtcSendStep = {
  type: "btc-send",
  from: "bc1q...",
  to: "bc1p...",
  amountSats: 100_000n,
  peelMemo: { hex: "5045454c01...", intentId: "uuid", bytes: Uint8Array }
}
```

- Add `peelMemo` as an `OP_RETURN` output (0-value) in the Bitcoin transaction
- UTXO selection, fee estimation, signing: handled by OWS

### `evm-transfer`

Agent builds an EVM native transfer using the chain-specific Peel function.

```ts
const step: EvmTransferStep = {
  type: "evm-transfer",
  chain: "rootstock",          // "bob" | "rootstock" | "citrea"
  from: "0x...",
  to: "0x...",
  amountWei: 1_000_000_000_000_000n,
  asset: "RBTC",
  peelMemo: { hex: "5045454c01...", ... }  // embed in tx data field
}
```

SDK call:
```ts
// Rootstock example
const intent = buildRootstockTransfer(step.from, step.to, step.amountWei, false)
const prepared = await prepareRootstockTx(intent, false)
// Sign with: ows sign tx --chain evm --tx <serializeRootstockTx(prepared)>
const signed = encodeRootstockSignedTx(prepared, owsSig)
const txHash = await broadcastRootstockTx(signed, false)
```

Use `buildBobEthTransfer` / `prepareBobTx` for BOB, and `buildCitreaTransfer` / `prepareCitreaTx` for Citrea.

### `stacks-transfer`

Agent uses the Stacks tx pipeline.

```ts
const step: StacksTransferStep = {
  type: "stacks-transfer",
  from: "SP...",
  to: "SP...",
  publicKey: "0365b706...",   // 33-byte compressed pubkey from OWS
  asset: "sBTC",              // "STX" | "sBTC"
  amountSats: 100_000n,
  peelMemo: { ... }           // present for STX; absent for sBTC (SIP-010 limitation)
}
```

SDK call:
```ts
const txRequest = step.asset === "sBTC"
  ? buildSbtcTransfer(step.from, step.to, step.amountSats, step.publicKey, false)
  : buildStxTransfer(step.from, step.to, step.amountSats, step.publicKey, false)

// Attach the Peel memo bytes — embedded in the tx automatically:
// - STX: native Stacks memo field (34-byte limit)
// - sBTC: SIP-010 transfer(amount, sender, recipient, memo) optional buff param
if (step.peelMemo) txRequest.memo = step.peelMemo.bytes

const prepared = await prepareStacksTx(txRequest)
// Sign with: ows sign tx --chain bitcoin --tx <prepared.preSignSigHash>
const signed = encodeStacksSignedTx(prepared, owsSig)
const txid = await broadcastStacksTx(signed, false)
```

### `bridge-deposit`

Agent calls the bridge-specific setup function to get the deposit address, then sends to it.

```ts
const step: BridgeDepositStep = {
  type: "bridge-deposit",
  bridge: "sbtc",             // "sbtc" | "flyover" | "bob-gateway"
  from: "bc1q...",
  amountSats: 100_000n,
  estimatedFeeSats: 80_000n,
  estimatedTimeSecs: 1200,
  params: {
    bridge: "sbtc",
    stacksAddress: "SP...",
    reclaimPublicKey: "65b706...",  // x-only 32-byte schnorr pubkey (strip 02/03)
    amountSats: 100_000n,
  },
  peelMemo: { ... }
}
```

**sBTC peg-in:**
```ts
const plan = await buildSbtcDepositPlan(step.params)
// → plan.depositAddress: send BTC here (include peelMemo as OP_RETURN)
// → plan.depositScript + plan.reclaimScript: preserved for notifySbtcDeposit
```

**Flyover peg-in:**
```ts
const adapter = new RootstockFlyoverBridgeAdapter({ disableChecksum: true })
const peginPlan = await adapter.getPegInPaymentPlan(step.params.amountSats, step.params.recipientRskAddress)
// → peginPlan.depositAddress: send BTC here
```

**BOB Gateway:**
```bash
gateway-cli swap --src BTC --dst ETH:bob --amount <sats> --recipient <bobAddress> --unsigned --json
```

### `bridge-notify`

sBTC peg-in only. Call immediately after BTC tx appears in mempool.

```ts
// After broadcasting BTC deposit tx:
const txHex = await fetch(`https://mempool.space/api/tx/${txid}/hex`).then(r => r.text())
await notifySbtcDeposit(sbtcPlan, txHex)
```

### `sbtc-withdrawal`

sBTC peg-out (Stacks → Bitcoin).

```ts
const step: SbtcWithdrawalStep = {
  type: "sbtc-withdrawal",
  from: "SP...",
  publicKey: "0365b706...",
  btcRecipient: "bc1p...",
  amountSats: 100_000n,
  maxFeeSats: 3_000n,
}
```

SDK call:
```ts
const prepared = await prepareSbtcWithdrawalTx({
  stacksAddress: step.from,
  publicKey: step.publicKey,
  btcRecipientAddress: step.btcRecipient,
  amountSats: step.amountSats,
  maxFeeSats: step.maxFeeSats,
})
// Sign with: ows sign tx --chain bitcoin --tx <prepared.preSignSigHash>
const signed = encodeStacksSignedTx(prepared, owsSig)
const txid = await broadcastStacksTx(signed, false)
```

---

## Peel memo

Every step includes a `peelMemo` (except `bridge-notify` and `sbtc-withdrawal`).
Embed it in the transaction to make the payment indexable by a future Peel indexer.

**Binary layout:** `PEEL(4) | version(1) | intentId(16) | userMemo(0–13)` = 21–34 bytes

| Tx type | How to embed |
|---|---|
| Bitcoin | Extra `OP_RETURN` output with `peelMemo.bytes`, value = 0 sats |
| EVM native | In the tx `data` field (`peelMemo.hex` as `0x`-prefixed hex) |
| STX transfer | In the Stacks `memo` field (34-byte limit — fits exactly) |
| sBTC / ERC-20 | Omitted (calldata occupied by contract call) |

The `intentId` in the memo ties every on-chain transaction back to the same routing decision. `plan.intent.id` and `step.peelMemo.intentId` are always the same UUID.

---

## Polling after execution

After executing bridge steps, poll for status using the bridge-specific poll function:

| Bridge | Function | Polls |
|---|---|---|
| sBTC peg-in | `pollSbtcDepositStatus(btcTxid)` | Emily API |
| Flyover peg-in | `adapter.pollStatus(quoteHash)` | Flyover LP |
| sBTC peg-out | `pollSbtcWithdrawalStatus(stacksAddress)` | Emily API |

---

## Full example — Bitcoin → Stacks (sBTC peg-in)

```ts
import {
  routePayment, buildSbtcDepositPlan, notifySbtcDeposit, pollSbtcDepositStatus
} from "@peelbtc/sdk";

const plan = await routePayment({ from: identity, to: "SP1...", amountSats: 100_000n })

// plan.steps[0]: bridge-deposit (sbtc)
// plan.steps[1]: bridge-notify

const depositStep = plan.steps[0]   // BridgeDepositStep
const notifyStep  = plan.steps[1]   // BridgeNotifyStep

// Step 1: get deposit address from Emily
const sbtcPlan = await buildSbtcDepositPlan(depositStep.params)
// sbtcPlan.depositAddress → send BTC here (add peelMemo as OP_RETURN)
// sbtcPlan.amountSats, sbtcPlan.deadlineUnix, sbtcPlan.maxSignerFee

// Step 2: agent builds, signs, broadcasts BTC tx via OWS
// Include peelMemo as OP_RETURN: depositStep.peelMemo.hex

// Step 3: notify signers (once in mempool)
const txHex = await fetch(`https://mempool.space/api/tx/${txid}/hex`).then(r => r.text())
await notifySbtcDeposit(sbtcPlan, txHex)

// Step 4: poll until sBTC arrives (~20 min)
const status = await pollSbtcDepositStatus(txid)
// status.status: "pending" | "confirmed" | "failed"
```

---

## Full example — Bitcoin → Rootstock (Flyover peg-in)

```ts
import {
  routePayment, RootstockFlyoverBridgeAdapter
} from "@peelbtc/sdk";

const plan = await routePayment({
  from: identity,
  to: "0x...",
  amountSats: 1_000_000n,
  destinationChain: "rootstock",
})

const depositStep = plan.steps[0]   // BridgeDepositStep { bridge: "flyover" }
const { recipientRskAddress, amountSats } = depositStep.params

const adapter = new RootstockFlyoverBridgeAdapter({ disableChecksum: true })
const peginPlan = await adapter.getPegInPaymentPlan(amountSats, recipientRskAddress)
// peginPlan.depositAddress → send BTC here
// peginPlan.amountSats, peginPlan.deadlineUnix, peginPlan.fees

// Agent builds, signs, broadcasts BTC tx via OWS
// Poll: adapter.pollStatus(peginPlan.quoteHash)
```

---

## Sources

- SDK entry: `/Users/eric/Code/Peel/packages/sdk/dist/index.js`
- Router source: `/Users/eric/Code/Peel/packages/sdk/src/router/`
- Bridge references: `./bridging/rootstock-flyover.md`, `./bridging/sbtc.md`, `./bridging/bob-gateway.md`
