# @peelbtc/sdk — Node.js API Reference

## Import

```javascript
import {
  // Balances
  fetchBalances,

  // BOB (EIP-1559, type 2)
  buildBobEthTransfer, buildBobTokenTransfer,
  prepareBobTx, serializeBobTx, encodeBobSignedTx, broadcastBobTx,

  // Rootstock (legacy type 0)
  buildRootstockTransfer,
  prepareRootstockTx, serializeRootstockTx, encodeRootstockSignedTx, broadcastRootstockTx,

  // Citrea (EIP-1559, type 2)
  buildCitreaTransfer,
  prepareCitreaTx, serializeCitreaTx, encodeCitreaSignedTx, broadcastCitreaTx,

  // Stacks (secp256k1, same curve as Bitcoin)
  buildStxTransfer, buildSbtcTransfer,
  prepareStacksTx, encodeStacksSignedTx, broadcastStacksTx,

  // Bridges
  RootstockFlyoverBridgeAdapter, FLYOVER_LBC_ADDRESS, FLYOVER_LIMITS,
  buildSbtcDepositPlan, notifySbtcDeposit, pollSbtcDepositStatus,
  prepareSbtcWithdrawalTx, pollSbtcWithdrawalStatus,
} from "/Users/eric/Code/Peel/packages/sdk/dist/index.js";
```

## Prerequisites

Build the full package tree before importing:

```bash
cd /Users/eric/Code/Peel
pnpm install
pnpm --filter @peelbtc/types build
pnpm --filter @peelbtc/core build
pnpm --filter @peelbtc/sdk build
```

All code must use `--input-type=module` or run inside an ESM context.

---

## Public Exports

| Group | Functions |
|---|---|
| Balances | `fetchBalances` |
| BOB txs | `buildBobEthTransfer`, `buildBobTokenTransfer`, `prepareBobTx`, `serializeBobTx`, `encodeBobSignedTx`, `broadcastBobTx` |
| Rootstock txs | `buildRootstockTransfer`, `prepareRootstockTx`, `serializeRootstockTx`, `encodeRootstockSignedTx`, `broadcastRootstockTx` |
| Citrea txs | `buildCitreaTransfer`, `prepareCitreaTx`, `serializeCitreaTx`, `encodeCitreaSignedTx`, `broadcastCitreaTx` |
| Stacks txs | `buildStxTransfer`, `buildSbtcTransfer`, `prepareStacksTx`, `encodeStacksSignedTx`, `broadcastStacksTx` |
| Rootstock bridge | `RootstockFlyoverBridgeAdapter`, `FLYOVER_LBC_ADDRESS`, `FLYOVER_LIMITS` |
| sBTC bridge | `buildSbtcDepositPlan`, `notifySbtcDeposit`, `pollSbtcDepositStatus`, `prepareSbtcWithdrawalTx`, `pollSbtcWithdrawalStatus` |
| EVM recipient recovery | `recoverEvmRecipientIdentity`, `recoverPublicKeyFromEvmAddress` |

---

## EVM Recipient Recovery

Recovers a full BRID identity from an EVM (`0x...`) address using any existing
signed transaction. Complements the Bitcoin + Stacks recovery in `@peelbtc/core`.

```ts
import { recoverEvmRecipientIdentity, recoverPublicKeyFromEvmAddress } from "@peelbtc/sdk";

// Full identity map from any 0x... address
const identity = await recoverEvmRecipientIdentity("0x2935C2...", {
  evmChain: "bob",                              // "bob" | "rootstock" | "citrea"
  evmExplorerApiUrl: "https://explorer.gobob.xyz",  // Blockscout API (fast path)
  // evmRpcUrl: "...",                           // override RPC
  // evmMaxBlockScan: 100,                       // fallback block scan limit
})
// identity.publicKey — recovered compressed pubkey
// identity.root      — Bitcoin address
// identity.derived   — [bitcoin, stacks, bob, rootstock, citrea]

// Just the pubkey
const pubkey = await recoverPublicKeyFromEvmAddress("0x2935C2...", { evmChain: "bob" })
// Uint8Array(33) — compressed secp256k1 pubkey, or null if no tx found
```

**How it works:** ECDSA recovers the sender's pubkey from any signed transaction.
Finding the tx uses the Blockscout explorer API if `evmExplorerApiUrl` is provided
(fast), or scans the last `evmMaxBlockScan` blocks (slower fallback).

**Explorer API URLs:**
- BOB mainnet: `https://explorer.gobob.xyz`
- Rootstock: `https://explorer.rootstock.io`
- Citrea mainnet: `https://explorer.mainnet.citrea.xyz`

**Limitation:** returns `null` for addresses that have never sent a transaction.

**Bitcoin and Stacks** recovery live in `@peelbtc/core` — see `core.md`.

Fetches native and BTC-pegged asset balances for all Peel-supported layers from a `BridIdentityMap`.

### Layers queried

| Layer     | Asset  | Kind    | Decimals |
|-----------|--------|---------|----------|
| Bitcoin   | BTC    | native  | 8        |
| Stacks    | STX    | native  | 6        |
| Stacks    | sBTC   | token   | 8        |
| BOB       | ETH    | native  | 18       |
| BOB       | wBTC   | token   | 8        |
| Rootstock | RBTC   | native  | 18       |
| Citrea    | cBTC   | native  | 18       |

### Return type

```typescript
interface BalanceMap {
  layers: LayerBalance[];  // one entry per asset per layer
  totalBtcSats: bigint;    // sum of all BTC-denominated balances, in satoshis
  fetchedAt: number;       // Unix timestamp ms
}
```

### Behavior

- All layers are fetched in parallel via `Promise.allSettled`
- A failing RPC for one layer does not fail the others — failed entries carry an `error` field with `balance: 0n`
- `totalBtcSats` sums only entries where `isBtc: true`
- EVM 18-decimal assets (RBTC, cBTC) are converted to satoshis via `wei / 10^10`
- 8-decimal assets (BTC, sBTC, wBTC) are already in satoshis

### Example

```javascript
import { fetchBalances } from "/Users/eric/Code/Peel/packages/sdk/dist/index.js";
import { buildBridIdentityMap } from "/Users/eric/Code/Peel/packages/core/dist/index.js";

// identity comes from @peelbtc/core — see core.md for the full BRID flow
const identity = buildBridIdentityMap(address, message, sigBase64);

const result = await fetchBalances(identity, {
  // all overrides optional — defaults come from the registry in @peelbtc/core
  bitcoin: "https://mempool.space/api",
  stacks:  "https://api.hiro.so",
  bob:     "https://rpc.gobob.xyz",
});

console.log("Total BTC (sats):", result.totalBtcSats.toString());

for (const entry of result.layers) {
  if (entry.error) {
    console.log(`  ${entry.layer} ${entry.asset}: ERROR — ${entry.error}`);
  } else {
    console.log(`  ${entry.layer} ${entry.asset}: ${entry.balance} (decimals: ${entry.decimals})`);
  }
}
```

### `LayerBalance` shape

```typescript
interface LayerBalance {
  layer: string;       // "bitcoin" | "stacks" | "bob" | "rootstock" | "citrea"
  address: string;     // the address queried
  asset: string;       // "BTC" | "STX" | "sBTC" | "ETH" | "wBTC" | "RBTC" | "cBTC"
  kind: "native" | "token";
  balance: bigint;     // in smallest unit (sats or wei depending on decimals)
  decimals: number;
  isBtc: boolean;      // true if this asset contributes to totalBtcSats
  testnet: boolean;
  error?: string;      // present only if the RPC call failed
}
```

---

## Rootstock Transaction Helpers

Rootstock uses **legacy (type 0) EVM transactions** — no EIP-1559. Uses `gasPrice` instead of `maxFeePerGas`.

```javascript
import {
  buildRootstockTransfer, prepareRootstockTx,
  serializeRootstockTx, encodeRootstockSignedTx, broadcastRootstockTx,
} from "/Users/eric/Code/Peel/packages/sdk/dist/index.js";
```

### Transaction lifecycle

```
buildRootstockTransfer(...)   → RootstockTxRequest   (intent)
           ↓
prepareRootstockTx(...)       → RootstockTxPrepared  (nonce, gas, gasPrice)
           ↓
serializeRootstockTx(...)     → Hex                  (unsigned legacy hex, no 0x02 prefix)
           ↓
ows sign tx --chain evm --tx <hex>  → r || s || v    (raw recovery ID, NOT send-tx)
           ↓
encodeRootstockSignedTx(...)  → Hex                  (signed broadcast-ready blob)
           ↓
broadcastRootstockTx(...)     → Hex                  (tx hash)
```

### Functions

`buildRootstockTransfer(from, to, value, testnet)` — `value` in wei. `testnet=true` → chainId 31, `false` → 30.

`prepareRootstockTx(tx, testnet, rpcUrl?)` — fetches nonce + `gasPrice` (not EIP-1559 fees).

`serializeRootstockTx(tx)` — produces legacy hex. Will **not** start with `0x02`.

`encodeRootstockSignedTx(tx, sig)` — injects OWS signature. Automatically applies EIP-155 `v` encoding (`chainId * 2 + 35 + recoveryId`). Accepts `v` as `0`/`1` (OWS) or `27`/`28` (viem).

`broadcastRootstockTx(signedTxHex, testnet, rpcUrl?)` — submits via `sendRawTransaction`.

### OWS signing — critical notes

Use `ows sign tx`, **not** `ows sign send-tx`. The `send-tx` path expects a typed tx (`0x01`/`0x02`) and will reject legacy hex:

```bash
ows sign tx --wallet <name> --chain evm --tx <unsignedHex> --json
```

`encodeRootstockSignedTx` handles EIP-155 `v` conversion internally — pass the raw OWS signature as-is.

### Example

```javascript
const intent = buildRootstockTransfer("0xSENDER", "0xRECIPIENT", 1n, true); // testnet
const prepared = await prepareRootstockTx(intent, true);
const unsignedHex = serializeRootstockTx(prepared);

// ows sign tx --chain evm --tx <unsignedHex> --json
const owsSig = { signature: "<hex r||s||v from OWS>" };

const signedHex = encodeRootstockSignedTx(prepared, owsSig);
const txHash = await broadcastRootstockTx(signedHex, true);
console.log("explorer: https://explorer.testnet.rsk.co/tx/" + txHash);
```

---

## Citrea Transaction Helpers

Citrea uses **EIP-1559 (type 2)** transactions — same pattern as BOB.

```javascript
import {
  buildCitreaTransfer, prepareCitreaTx,
  serializeCitreaTx, encodeCitreaSignedTx, broadcastCitreaTx,
} from "/Users/eric/Code/Peel/packages/sdk/dist/index.js";
```

### Functions

`buildCitreaTransfer(from, to, value, testnet)` — `value` in wei. `testnet=true` → chainId 5115 (testnet), `false` → 4114 (mainnet).

`prepareCitreaTx(tx, testnet, rpcUrl?)` — fetches nonce + EIP-1559 fee data.

`serializeCitreaTx(tx)` — produces `0x02...` hex.

`encodeCitreaSignedTx(tx, sig)` — attaches signature. `v` is `yParity` (0 or 1) for type-2 txs.

`broadcastCitreaTx(signedTxHex, testnet, rpcUrl?)` — submits via `sendRawTransaction`.

### Example

```javascript
const intent = buildCitreaTransfer("0xSENDER", "0xRECIPIENT", 1n, true); // testnet
const prepared = await prepareCitreaTx(intent, true);
const unsignedHex = serializeCitreaTx(prepared);

// ows sign-transaction --chain evm --tx <unsignedHex> --json
const owsSig = { signature: "<hex r||s||v from OWS>" };

const signedHex = encodeCitreaSignedTx(prepared, owsSig);
const txHash = await broadcastCitreaTx(signedHex, true);
console.log("explorer: https://explorer.testnet.citrea.xyz/tx/" + txHash);
```

Testnet faucet: `https://faucet.testnet.citrea.xyz`

---

## Stacks Transaction Helpers

Stacks uses **secp256k1** — the same curve as Bitcoin. Signing is done with the OWS Bitcoin signer.

```javascript
import {
  buildStxTransfer, buildSbtcTransfer,
  prepareStacksTx, encodeStacksSignedTx, broadcastStacksTx,
} from "/Users/eric/Code/Peel/packages/sdk/dist/index.js";
```

### Transaction lifecycle

```
buildStxTransfer(...)       → StacksTxRequest    (STX native transfer)
buildSbtcTransfer(...)      → StacksTxRequest    (sBTC SIP-010 transfer)
         ↓
prepareStacksTx(...)        → StacksTxPrepared   (nonce, fee, preSignSigHash)
         ↓
ows sign tx --chain bitcoin --tx <preSignSigHash>  → r || s || v
         ↓
encodeStacksSignedTx(...)   → string             (broadcast-ready hex)
         ↓
broadcastStacksTx(...)      → string             (txid)
```

### Functions

`buildStxTransfer(from, to, amount, publicKey, testnet)` — `amount` in **microSTX** (1 STX = 1,000,000 microSTX).

`buildSbtcTransfer(from, to, amount, publicKey, testnet)` — `amount` in **satoshis** (8 decimals).

`prepareStacksTx(tx, fee?, hiroBaseUrl?)` — fetches nonce from Hiro API (prefers mempool-aware `possible_next_nonce`). Default fee: 2000 microSTX.

`encodeStacksSignedTx(prepared, sig)` — converts OWS `r||s||v` to Stacks `v||r||s` automatically.

`broadcastStacksTx(signedTxHex, testnet)` — broadcasts to Stacks node.

### `publicKey` — compressed key requirement

**Always pass the 33-byte compressed pubkey (66 hex chars, prefix `02` or `03`).**

Stacks derives addresses from the **compressed** secp256k1 public key. This follows the
Stacks convention of appending an `01` byte to the raw 32-byte private key before address
derivation — the `01` signals "use compressed key format." The practical consequence:

- ✅ `OWS_PUBKEY` from `ows wallet info --json` → already the 33-byte compressed key
- ❌ Uncompressed key (65 bytes, prefix `04`) → derives a **different** address → `NotEnoughFunds` on broadcast, even if the wallet is funded
- ❌ Using `viem.privateKeyToAccount(privKey).publicKey` directly → returns uncompressed in some versions → wrong address

If you derive the Stacks address from a private key programmatically, strip the `02`/`03`
prefix check:

```ts
// Safe: use @stacks/transactions publicKeyToAddress with the COMPRESSED key
const stxAddress = publicKeyToAddress("0365b706...", "testnet")  // 66 hex chars, starts with 02/03

// Unsafe: viem may return uncompressed (130 hex chars, starts with 04)
// Convert to compressed before passing to Stacks functions
```

Source for the correct key: `ows wallet info --wallet <name> --json` → `publicKey` field (always compressed).

### OWS signing — `ows sign tx`, not `ows sign send-tx`

The `preSignSigHash` is a raw 32-byte hash that must be signed **without re-hashing**.
Use `ows sign tx` with `--chain bitcoin`:

```bash
# preSignSigHash is already hashed — the signer must NOT hash it again
ows sign tx --chain bitcoin --tx <prepared.preSignSigHash> --json
# Returns: { signature: "<hex r||s||v>" }
```

Do **not** use `ows sign send-tx` — that path is for broadcasting, not raw signing.
Do **not** use `ows sign message` — that path re-hashes the payload.

`encodeStacksSignedTx` converts OWS `r||s||v` format to Stacks `v||r||s` format automatically.
Pass the raw OWS signature as-is — no manual reordering needed.

### Example — sBTC transfer (testnet)

```javascript
const intent = buildSbtcTransfer(
  "ST...",           // sender (ST... for testnet)
  "ST...",           // recipient
  1n,               // 1 satoshi
  "0365b706...",    // 33-byte compressed pubkey from OWS
  true,             // testnet
);

const prepared = await prepareStacksTx(intent, 2000n, "https://api.testnet.hiro.so");
// prepared.preSignSigHash → 32-byte hex, pass to OWS

// ows sign tx --chain bitcoin --tx <prepared.preSignSigHash> --json
const owsSig = { signature: "<hex r||s||v from OWS>" };

const signedHex = encodeStacksSignedTx(prepared, owsSig);
const txid = await broadcastStacksTx(signedHex, true);
console.log("explorer: https://explorer.hiro.so/txid/" + txid + "?chain=testnet");
```

### Required env vars (integration tests)

| Var | Description |
|---|---|
| `OWS_BRID_STACKS_TESTNET` | Stacks testnet address (ST...) |
| `OWS_PUBKEY` | 33-byte compressed pubkey hex (from `ows wallet info`) |
| `OWS_PRIVKEY` | Raw 32-byte private key hex (for test signing) |

---

All BOB transaction helpers are exported from the package entrypoint — use the same import as `fetchBalances`:

```javascript
import {
  buildBobEthTransfer,
  buildBobTokenTransfer,
  prepareBobTx,
  serializeBobTx,
  encodeBobSignedTx,
  broadcastBobTx,
} from "/Users/eric/Code/Peel/packages/sdk/dist/index.js";
```

### Transaction lifecycle

```
buildBobTokenTransfer(...)   → EvmTxRequest   (intent, no gas/nonce yet)
         ↓
prepareBobTx(...)            → EvmTxPrepared  (live nonce, gas, EIP-1559 fees)
         ↓
serializeBobTx(...)          → Hex            (unsigned RLP-encoded 0x02... blob)
         ↓
OWS sign_transaction(...)    → OwsSignResult  (r || s || v signature)
         ↓
encodeBobSignedTx(...)       → Hex            (signed broadcast-ready blob)
         ↓
broadcastBobTx(...)          → Hex            (tx hash)
```

### `buildBobTokenTransfer(from, recipient, tokenContract, amount, testnet)`

Builds an unsigned ERC-20 token transfer intent.

- `from` — sender EVM address
- `recipient` — token recipient EVM address
- `tokenContract` — ERC-20 contract address (e.g. wBTC on BOB)
- `amount` — transfer amount in token's smallest unit (`bigint`)
- `testnet` — `true` → bobSepolia (808813), `false` → BOB mainnet (60808)

Returns `EvmTxRequest` — no gas or nonce yet.

### `prepareBobTx(tx, testnet, rpcUrl?)`

Fetches live nonce, gas estimate, and EIP-1559 fee data from the BOB RPC. Returns a fully populated `EvmTxPrepared`.

Must be called immediately before signing — nonce and fee data go stale.

### `serializeBobTx(tx)`

RLP-encodes the unsigned prepared tx into the `0x02...` hex blob to pass to the signer.

### `encodeBobSignedTx(tx, sig)`

Attaches an OWS (or compatible) signature to the prepared tx and returns the broadcast-ready signed hex.

`sig.signature` must be hex-encoded 65 bytes: `r(32) || s(32) || v(1)`.

Recovery byte conventions accepted:
- `0` or `1` — raw ECDSA recovery ID (OWS output)
- `27` or `28` — legacy Ethereum convention

viem normalizes both to yParity for type-2 transaction serialization.

### `broadcastBobTx(signedTxHex, testnet, rpcUrl?)`

Submits the signed tx to BOB via `sendRawTransaction` and returns the tx hash.

### BOB wBTC contract addresses

```
wBTC mainnet (BOB 60808):    0x0555E30da8f98308EdB960aa94C0Db47230d2B9c
wBTC testnet (bobSepolia):   ⚠️ placeholder — not verified
```

### Full flow example

```javascript
import {
  buildBobTokenTransfer,
  prepareBobTx,
  serializeBobTx,
  encodeBobSignedTx,
  broadcastBobTx,
} from "/Users/eric/Code/Peel/packages/sdk/dist/index.js";

const WBTC_MAINNET = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

const intent = buildBobTokenTransfer(
  "0xSENDER",
  "0xRECIPIENT",
  WBTC_MAINNET,
  100n,   // 100 sats worth of wBTC
  false   // mainnet
);

const prepared = await prepareBobTx(intent, false);
const unsignedHex = serializeBobTx(prepared);

// Pass unsignedHex to OWS:
// ows sign-transaction --wallet <name> --chain evm --tx <unsignedHex> --json
// OWS returns: { recovery_id: 0|1, signature: "<hex r||s||v>" }
const owsSig = { signature: "<hex from OWS>" };

const signedHex = encodeBobSignedTx(prepared, owsSig);
const txHash = await broadcastBobTx(signedHex, false);
console.log("tx hash:", txHash);
console.log("explorer: https://explorer.gobob.xyz/tx/" + txHash);
```

---

## Integration Tests

```bash
cd /Users/eric/Code/Peel
set -a; source .env.local; set +a
pnpm --filter @peelbtc/sdk test:integration
```

Required env vars (`.env.local`):

| Var | Used by |
|---|---|
| `OWS_BRID_EVM` | BOB, Rootstock, Citrea balance + prepare tests |
| `OWS_BRID_STACKS_TESTNET` | Stacks balance + prepare tests |
| `OWS_PUBKEY` | Stacks tx signing (33-byte compressed pubkey) |
| `OWS_PRIVKEY` | All signing + broadcast tests (raw 32-byte hex) |

Test files and coverage:

| File | Tests |
|---|---|
| `bob.integration.test.ts` | Balance, prepare, sign, encode, broadcast (mainnet — needs wBTC) |
| `rootstock.integration.test.ts` | Balance (mainnet), prepare+serialize, sign, encode, broadcast (testnet) |
| `citrea.integration.test.ts` | Balance (testnet), prepare+serialize, sign, encode, broadcast (testnet — needs cBTC) |
| `stacks.integration.test.ts` | Balance (testnet), prepare STX+sBTC, sign, encode, broadcast sBTC (testnet) |

---

## Known Caveats

- BOB wBTC testnet contract address is unverified — check before using on bobSepolia
- Citrea and BOB testnet ERC-20 addresses may be placeholders — marked `⚠️ VERIFY` in source
- sBTC testnet contract: `ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token`
- Stacks sBTC bridging (`buildSbtcDepositPlan`, `prepareSbtcWithdrawalTx`) is **mainnet only**
