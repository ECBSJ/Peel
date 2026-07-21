# @peelbtc/sdk

A Payments Engine for Every Layer. Route sats across Bitcoin L1 and L2s — BOB, Rootstock, Citrea, Stacks — with a single intent.

Part of the [Peel](https://github.com/ECBSJ/Peel) monorepo.

## Install

```bash
npm install @peelbtc/sdk@alpha
```

> **Alpha release.** Early testers only. API may change before stable.

## What it does

Peel abstracts away Bitcoin's L2 fragmentation. Describe what you want to pay — Peel figures out the chain, asset, bridge, and route.

```ts
import { routePayment } from "@peelbtc/sdk";
import { buildBridIdentityMap } from "@peelbtc/core";

const plan = await routePayment({
  from: identity,           // sender's cross-chain identity
  to:   "SP1...",           // destination — any address, any chain
  amountSats: 100_000n,     // always in sats
});

// plan.steps[] — what to execute, in order
// plan.intent  — resolved route, fees, timing, Peel memo
```

## Supported chains

| Chain | Asset | Tx type | Bridge |
|---|---|---|---|
| Bitcoin L1 | BTC | UTXO | — |
| Stacks | STX, sBTC | secp256k1 | sBTC (BTC ↔ sBTC) |
| BOB | ETH, wBTC | EIP-1559 | BOB Gateway (BTC ↔ wBTC) |
| Rootstock | RBTC | Legacy EVM | Flyover (BTC ↔ rBTC) |
| Citrea | cBTC | EIP-1559 | Direct only |

## API overview

### Balances

```ts
import { fetchBalances } from "@peelbtc/sdk";

const result = await fetchBalances(identity);
// result.totalBtcSats — sum across all layers
// result.layers[]     — per-chain breakdown
```

### Routing

```ts
import { routePayment } from "@peelbtc/sdk";

const plan = await routePayment({ from, to, amountSats });
// Handles address detection, bridge selection, liveness checks,
// fee scoring, and Peel memo encoding automatically
```

### Transactions

Each chain has its own prepare → sign → encode → broadcast pipeline:

```ts
// Rootstock (legacy EVM)
import { buildRootstockTransfer, prepareRootstockTx, encodeRootstockSignedTx, broadcastRootstockTx } from "@peelbtc/sdk";

// Stacks (secp256k1, same curve as Bitcoin)
import { buildSbtcTransfer, prepareStacksTx, encodeStacksSignedTx, broadcastStacksTx } from "@peelbtc/sdk";

// BOB + Citrea (EIP-1559)
import { buildBobTokenTransfer, prepareBobTx, encodeBobSignedTx, broadcastBobTx } from "@peelbtc/sdk";
```

All signing is external — Peel returns unsigned tx data and you sign with your own signer (OWS, MetaMask, etc.).

### Bridges

```ts
// sBTC: BTC → sBTC on Stacks (mainnet)
import { buildSbtcDepositPlan, notifySbtcDeposit, pollSbtcDepositStatus } from "@peelbtc/sdk";

// Flyover: BTC ↔ rBTC on Rootstock
import { RootstockFlyoverBridgeAdapter } from "@peelbtc/sdk";
const adapter = new RootstockFlyoverBridgeAdapter({ disableChecksum: true });
const plan = await adapter.getPegInPaymentPlan(amountSats, recipientRskAddress);
```

### Recipient recovery

Recover a full cross-chain identity from a recipient address without requiring them to sign anything:

```ts
// From Stacks or Bitcoin address
import { recoverRecipientIdentity } from "@peelbtc/core";

// From EVM address (uses on-chain transaction data)
import { recoverEvmRecipientIdentity } from "@peelbtc/sdk";
const identity = await recoverEvmRecipientIdentity("0x...", { evmChain: "bob" });
```

## Signing with OWS

Peel is designed to work with [Open Wallet Standard](https://github.com/ECBSJ/Open-Wallet-Standard) for non-custodial signing:

```bash
# EVM chains (BOB, Citrea)
ows sign-transaction --chain evm --tx <unsignedHex>

# Rootstock (legacy tx — use sign tx, not send-tx)
ows sign tx --chain evm --tx <unsignedHex>

# Stacks (pre-hashed secp256k1 — use Bitcoin signer)
ows sign tx --chain bitcoin --tx <preSignSigHash>
```

## License

MIT
