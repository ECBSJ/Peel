# sBTC Bridge — BTC ↔ sBTC on Stacks Reference

## What it is

sBTC is the canonical Bitcoin representation on Stacks: a SIP-010 token backed
1:1 by BTC held by a decentralised federation of sBTC Signers. Bridging is
handled by the Signers network and coordinated via the Emily API
(`https://sbtc-emily.com`).

**Mainnet only.** Testnet sBTC bridging is not supported by this module.

| Direction | Key step | Who signs |
|---|---|---|
| BTC → sBTC (peg-in) | `buildSbtcDepositPlan()` → OWS BTC tx → `notifySbtcDeposit()` | Agent (Bitcoin) |
| sBTC → BTC (peg-out) | `prepareSbtcWithdrawalTx()` → OWS Stacks tx | Agent (Stacks) |

## Import

```ts
import {
  buildSbtcDepositPlan,
  notifySbtcDeposit,
  pollSbtcDepositStatus,
  prepareSbtcWithdrawalTx,
  pollSbtcWithdrawalStatus,
  decodeBtcAddress,
  type SbtcDepositPlan,
  type SbtcDepositStatusEntry,
  type SbtcWithdrawalStatusEntry,
} from "@peelbtc/sdk";

// Stacks tx pipeline (also needed for peg-out):
import {
  encodeStacksSignedTx,
  broadcastStacksTx,
} from "@peelbtc/sdk";
```

---

## Peg-in: BTC → sBTC

### Step 1 — Build deposit plan

```ts
const plan: SbtcDepositPlan = await buildSbtcDepositPlan({
  amountSats: 100_000n,            // sats to bridge (must be > 0)
  stacksAddress: "SP...",          // Stacks address to receive sBTC
  reclaimPublicKey: "<32-byte-hex>", // see note below
  reclaimLockTime: 950,            // optional — BTC blocks before reclaim (default: 950)
  maxSignerFee: 80_000,            // optional — max sats signers may charge (default: 80_000)
})
```

**`reclaimPublicKey` — x-only 32-byte schnorr pubkey:**
The reclaim tapscript uses the depositor's key so they can recover funds if the
Signers don't process the deposit within `reclaimLockTime` blocks. This is the
depositor's BTC public key with the `02`/`03` compression prefix stripped — the
32-byte x-coordinate only (64 hex chars).

```ts
// Derive from OWS compressed pubkey (66 hex chars):
const owsPubKey = "0365b706..."; // from `ows wallet info --json` → publicKey
const reclaimPublicKey = owsPubKey.slice(2); // strip "02" or "03" prefix → 64 hex chars
```

Key fields returned:

| Field | Description |
|---|---|
| `depositAddress` | P2TR BTC address to send to |
| `amountSats` | Exact sats to send |
| `maxSignerFee` | Max sats deducted from minted sBTC for the sweep tx |
| `reclaimLockTime` | BTC blocks until reclaim is possible |
| `signersPublicKey` | Signers' x-only aggregate schnorr pubkey (informational) |
| `estimatedMintTimeSecs` | ~1200 (20 min) |

The deposit address is a **custom P2TR address** — not the Signers' main address.
It contains two tapscripts:
- **Deposit script**: lets Signers sweep the UTXO and mint sBTC.
- **Reclaim script**: lets the depositor reclaim after `reclaimLockTime` blocks.

### Step 2 — Build BTC transaction (agent-side, OWS)

Construct a Bitcoin transaction using OWS:
- **Output**: `plan.amountSats` sats to `plan.depositAddress`
- UTXO selection, fee estimation, and signing handled externally by OWS

### Step 3 — Notify the sBTC Signers

Call this immediately after the BTC tx appears in the mempool. The Emily API
requires the full raw hex of the transaction.

```ts
// Fetch tx hex from mempool.space after broadcasting:
const txHex = await fetch(`https://mempool.space/api/tx/${txid}/hex`).then(r => r.text())

const response = await notifySbtcDeposit(plan, txHex)
// response.status: "pending" | "confirmed" | ...
// response.bitcoinTxid, response.amount, response.parameters, etc.
```

### Step 4 — Poll until sBTC arrives

```ts
const status: SbtcDepositStatusEntry = await pollSbtcDepositStatus(txid)
// status.status: "pending" | "confirmed" | "failed"
// status.fulfillment.StacksTxid — Stacks mint tx hash (when confirmed)
// status.fulfillment.BitcoinTxid — Signers' sweep tx hash (when confirmed)
```

Typical time: **~20 minutes** (1–2 BTC confirmations). The actual fee charged by
the Signers is deducted from the minted sBTC amount (up to `maxSignerFee`).

---

## Peg-out: sBTC → BTC

### Step 1 — Prepare withdrawal tx

```ts
const prepared = await prepareSbtcWithdrawalTx({
  stacksAddress: "SP...",          // sender (must hold sBTC)
  publicKey: "<33-byte-hex>",      // OWS compressed pubkey (from `ows wallet info --json`)
  btcRecipientAddress: "bc1p...",  // BTC address to receive withdrawn BTC
  amountSats: 100_000n,            // sBTC to withdraw, in satoshis
  maxFeeSats: 3_000n,              // optional — max fee for BTC sweep tx (default: 3_000)
})
// prepared.preSignSigHash → 32-byte hex, pass to OWS for signing
```

**Supported BTC address types:** P2TR (`bc1p...`), P2WPKH (`bc1q...`),
P2SH (`3...`), P2PKH (`1...`).

The contract call locks `amountSats + maxFeeSats` sBTC. If the actual sweep fee
is less than `maxFeeSats`, the difference is refunded as sBTC.

### Step 2 — Sign (agent-side, OWS)

```
ows sign tx --chain bitcoin --tx <prepared.preSignSigHash>
```

Returns `r || s || v` (OWS format). The Stacks signing flow is identical to
sBTC transfers — same secp256k1 curve, same OWS command.

### Step 3 — Encode and broadcast

```ts
const signedHex = encodeStacksSignedTx(prepared, { signature: owsSig })
const txid = await broadcastStacksTx(signedHex, false) // false = mainnet
```

The Stacks tx confirms in seconds. The BTC withdrawal takes longer.

### Step 4 — Poll until BTC arrives

```ts
const withdrawals: SbtcWithdrawalStatusEntry[] = await pollSbtcWithdrawalStatus("SP...")
// withdrawals[0].status: "pending" | "accepted" | "confirmed" | "failed"
// withdrawals[0].txid — BTC txid when confirmed
```

Typical time: **~1 hour** (6 BTC confirmations). The Emily API does not return
the BTC txid until after it is confirmed on-chain.

---

## Utility: `decodeBtcAddress`

Decodes any BTC address into the `{ version, hashbytes }` Clarity tuple required
by the sBTC withdrawal contract. Used internally by `prepareSbtcWithdrawalTx`.

```ts
const { version, hashbytes } = decodeBtcAddress("bc1p...")
// version: Uint8Array(1) — 0x06 for P2TR, 0x04 for P2WPKH, 0x00 for P2PKH, etc.
// hashbytes: Uint8Array(32) for P2TR/P2WSH, Uint8Array(20) for others
```

---

## Contracts (mainnet)

| Contract | Address |
|---|---|
| `sbtc-token` | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| `sbtc-withdrawal` | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal` |

## Timing, fees, and limits

| Flow | Minimum | Typical time | Fee notes |
|---|---|---|---|
| Peg-in | **0.0001 BTC** (10,000 sats) | ~20 min (1–2 BTC confs) | `maxSignerFee` sats deducted from minted sBTC |
| Peg-out | **0.0001 BTC** (10,000 sats) | ~1 hour (6 BTC confs) | `maxFeeSats` locked, difference refunded as sBTC |

## Sources

- sBTC docs: https://docs.stacks.co/more-guides/sbtc/bridging-bitcoin/
- Emily API: https://sbtc-emily.com
- sBTC token contract: https://explorer.hiro.so/txid/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token?chain=mainnet
