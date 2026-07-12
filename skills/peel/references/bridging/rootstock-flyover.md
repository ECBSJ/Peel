# Rootstock Flyover — BTC ↔ rBTC Bridge Reference

## What it is

Rootstock Flyover is a fast BTC bridge that uses Liquidity Providers (LPs) to advance
funds while the underlying PowPeg settles in the background. Users get rBTC in
20–60 minutes instead of the ~17 hours PowPeg requires natively.

The Peel SDK wraps the Flyover SDK in `RootstockFlyoverBridgeAdapter`, exposing an
agent-first API: quote and accept flows return data for the agent to act on; the
agent constructs and signs transactions externally via OWS.

| Direction | Method | Who signs |
|---|---|---|
| BTC → rBTC (peg-in) | `getPegInPaymentPlan()` → OWS BTC tx | Agent (Bitcoin) |
| rBTC → BTC (peg-out) | `getPegoutQuote()` → OWS RSK tx | Agent (Rootstock) |

## Install / import

```ts
import {
  RootstockFlyoverBridgeAdapter,
  FLYOVER_LIMITS,
  FLYOVER_LBC_ADDRESS,
  type PegInPaymentPlan,
  type RootstockPegoutQuoteResult,
} from "@peelbtc/sdk";
```

## Setup

```ts
const adapter = new RootstockFlyoverBridgeAdapter({
  testnet: false,           // true for testnet
  disableChecksum: true,    // required when using OWS/BRID-derived addresses
});
```

`disableChecksum: true` is required because OWS produces standard EIP-55 checksummed
addresses, not RSK-checksummed ones. Omitting this will cause address validation errors.

## Protocol limits

```ts
FLYOVER_LIMITS.minPegInSats    // 500_001n  (0.00500001 BTC)
FLYOVER_LIMITS.maxPegInSats    // 1_500_000_000n  (15 BTC, LP-set)
FLYOVER_LIMITS.minPegOutWei    // 4_000_000_000_000_000n  (0.004 rBTC)
FLYOVER_LIMITS.maxPegOutWei    // 15_000_000_000_000_000_000n  (15 rBTC, LP-set)
```

Max limits are set by each LP and will increase over time.

## LBC contract addresses

```ts
FLYOVER_LBC_ADDRESS.mainnet   // "0xaa9caf1e3967600578727f975f283446a3da6612"
FLYOVER_LBC_ADDRESS.testnet   // "0xc2a630c053d12d63d32b025082f6ba268db18300"
```

---

## Peg-in: BTC → rBTC

### Step 1 — Get payment plan

```ts
const plan: PegInPaymentPlan = await adapter.getPegInPaymentPlan(
  amountSats,          // bigint — must be ≥ FLYOVER_LIMITS.minPegInSats
  recipientRskAddress, // RSK address to receive rBTC (EIP-55 checksummed)
)
```

**Save the entire `plan` object.** `plan.quote`, `plan.lpSignature`, and
`plan.bitcoinDepositAddressHash` are all required downstream.

Key fields returned:

| Field | Type | Description |
|---|---|---|
| `depositAddress` | `string` | BTC address to send to |
| `amountSats` | `bigint` | Exact sats to send (includes LP fees) |
| `deadlineUnix` | `number` | Unix timestamp — deposit must confirm before this |
| `quoteHash` | `string` | Tracking ID for `pollStatus()` |
| `requiredBtcConfirmations` | `number` | Confirmations LP waits for before acting |
| `fees.callFeeWei` | `bigint` | LP service fee (wei) |
| `fees.gasFeeWei` | `bigint` | Gas fee (wei) |
| `fees.totalWei` | `bigint` | Total in wei (= `amountSats` × 10^10) |

### Step 2 — Build BTC transaction (agent-side, OWS)

Construct a Bitcoin UTXO transaction:
- **Output**: `plan.amountSats` sats to `plan.depositAddress`
- The deposit address is unique to this quote — derived by the LP from the quote hash
- UTXO selection, fee estimation, and signing handled by OWS

### Step 3 — Validate before broadcasting

```ts
const error = await adapter.validatePegInTransaction(plan, rawBtcTxHex)
if (error) throw new Error(`invalid peg-in tx: ${error}`)
```

Pass the raw hex-encoded signed Bitcoin transaction. The SDK verifies the output
amount and address are correct. Always call this before broadcasting — the LBC
cannot reject an invalid tx until after it confirms.

### Step 4 — Broadcast (agent-side, OWS)

Broadcast the signed transaction to Bitcoin. Save the resulting `txid`.

### Step 5 — Poll status

```ts
const status = await adapter.pollStatus(plan.quoteHash)
// status.status: "pending" | "confirming" | "minting" | "completed" | "failed"
// status.sourceTxid: user's BTC txid (once seen by LP)
// status.destinationTxid: RSK callForUser or registerPegIn tx hash
```

Typical timeline: **20–60 min** (amount-dependent — smaller amounts need fewer
confirmations). `requiredBtcConfirmations` from the plan gives the exact confirmation
threshold for this quote.

Once the LP sees enough confirmations, it calls `callForUser` on the LBC and the
recipient receives rBTC on Rootstock.

### Step 6 — Recovery (only if LP fails)

If `pollStatus` is stuck and the LP has not registered the peg-in:

```ts
import { Mempool } from "@rsksmart/flyover-sdk";

// Provide data sources — Mempool.space is sufficient (no node needed)
adapter.connectToBitcoin(new Mempool({ network: "mainnet" }));
await adapter.connectToRsk(rskConnectionWithSigner);

// SDK fetches BTC SPV proof automatically and calls registerPegIn on the LBC
const rskTxHash = await adapter.registerPegIn(plan, txid);
```

The RSK Bridge verifies the BTC Merkle proof and refunds the LBC. The LP's
collateral is slashed if they missed the deadline. The user already received
rBTC at step 5 regardless — this is a cleanup step for the LP's settlement.

To get the full parameter breakdown without executing (for manual encoding):

```ts
const info = adapter.getRegisterPegInInfo(plan, txid)
// info.lbcAddress  — RSK contract to call
// info.valueRbtc   — 0n (registerPegIn is nonpayable)
// info.quote       — quote object
// info.lpSignature — LP commitment signature
// info.userBtcTxHash — your BTC txid
```

---

## Peg-out: rBTC → BTC

### Step 1 — Get quote

```ts
const result: RootstockPegoutQuoteResult = await adapter.getPegoutQuote(
  amountSats,           // bigint — amount in satoshis to receive in BTC
  btcRecipientAddress,  // Bitcoin address to receive BTC
  rskRefundAddress,     // RSK address for refund if LP fails
)
```

Key fields:

| Field | Type | Description |
|---|---|---|
| `result.lbcAddress` | `string` | LBC contract address — RSK tx recipient |
| `result.totalAmountWei` | `bigint` | Exact wei to send with the RSK tx |
| `result.totalAmountSats` | `bigint` | Same amount in satoshis |
| `result.signature` | `string` | LP commitment signature |
| `result.quoteHash` | `string` | Tracking ID |
| `result.quote` | `PegoutQuote` | Full quote (preserve for `depositPegout`) |

### Step 2 — Deposit rBTC (agent-side, OWS)

Construct a Rootstock legacy transaction using the Peel SDK:

```ts
import { prepareRootstockTx, serializeRootstockTx, encodeRootstockSignedTx, broadcastRootstockTx } from "@peelbtc/sdk";

// The depositPegout call must be sent directly via the connected RSK signer
// or by constructing the calldata manually using the LBC ABI.
// Alternatively, use the adapter's depositPegout() with a connected signer:
await adapter.connectToRsk(rskConnectionWithSigner);
const rskTxHash = await adapter.depositPegout(result.quote, result.signature);
```

> `depositPegout` is the one method that requires an active RSK signer connection.
> It calls `depositPegout(quote, signature)` on the LBC with `result.totalAmountWei` as value.

### Step 3 — Poll status

```ts
const status = await adapter.getPegoutStatus(result.quoteHash)
// status.status: "pending" | "confirming" | "minting" | "completed" | "failed"
// status.sourceTxid: user's RSK deposit tx
// status.destinationTxid: LP's BTC payout tx
```

Once the rBTC deposit has enough Rootstock confirmations, the LP sends BTC to
`btcRecipientAddress`. Typical time: **20–60 min**.

---

## Relationship to Peel

- `RootstockFlyoverBridgeAdapter` handles **bridging**: BTC L1 ↔ Rootstock via Flyover.
- The Rootstock tx pipeline (`prepareRootstockTx`, `serializeRootstockTx`, etc.) handles
  **in-chain RBTC transfers** once funds are on Rootstock.
- These are complementary: bridge in with Flyover, then use the tx pipeline to move rBTC
  on Rootstock.

## Supported BTC address types

P2PKH, P2SH, P2WPKH (native segwit), P2WSH, and P2TR (taproot) are all supported.

## Sources

- Flyover SDK: https://github.com/rsksmart/flyover-sdk
- LBC contract: https://github.com/rsksmart/liquidity-bridge-contract
- Protocol docs: https://dev.rootstock.io/developers/integrate/flyover/
