# @peelbtc/sdk — Node.js API Reference

## Import

```javascript
import {
  fetchBalances,
  buildBobEthTransfer,
  buildBobTokenTransfer,
  prepareBobTx,
  serializeBobTx,
  encodeBobSignedTx,
  broadcastBobTx,
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

The `@peelbtc/sdk` package entrypoint currently exports:

- `fetchBalances(identity, overrides?)` — multi-layer balance orchestrator
- Re-exported types from `@peelbtc/types`:
  - `BalanceMap`
  - `LayerBalance`
  - `RpcOverrides`
  - `BalanceKind`

---

## `fetchBalances(identity, overrides?)`

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

## BOB Transaction Helpers

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

BOB integration tests (mainnet):

```bash
cd /Users/eric/Code/Peel
set -a; source .env.local; set +a
pnpm --filter @peelbtc/sdk test:integration
```

Required env vars (from `.env.local`):
- `OWS_BRID_EVM` — EVM address for read-only balance tests
- `OWS_PRIVKEY` — raw private key hex (no 0x prefix) for signing tests

Test coverage:
1. Balance fetching — ETH + wBTC from BOB mainnet
2. Tx preparation — nonce, gas, fee data, RLP encoding
3. Signing — r, s, v output from private key
4. Encoding — signed broadcast-ready blob
5. Broadcast — submit to BOB mainnet, return tx hash

---

## Rootstock Signing Notes

### Use `ows sign tx`, not `ows sign send-tx`

Peel serializes Rootstock transactions as **unsigned legacy (type 0) EVM transactions** — no `0x01`/`0x02` type prefix. OWS's `sign send-tx` path expects a typed transaction and will reject legacy hex. Always use `ows sign tx` for Rootstock:

```bash
# Serialize the unsigned tx via Peel, then sign with OWS:
ows sign tx --wallet <name> --chain evm --tx <unsignedHex> --json
# Returns: { recovery_id: 0|1, signature: "<hex r||s||v>" }
```

### EIP-155 `v` is handled internally

`encodeRootstockSignedTx` automatically converts the raw recovery ID (`0`/`1`) from OWS into the EIP-155 legacy `v` value required by Rootstock:

```
v = chainId * 2 + 35 + recoveryId
```

For Rootstock mainnet (chainId 30): `v` = 95 or 96  
For Rootstock testnet (chainId 31): `v` = 97 or 98

Passing the raw OWS signature directly to `encodeRootstockSignedTx` is correct — no manual conversion needed. Both raw recovery IDs (`0`/`1`) and legacy Ethereum form (`27`/`28`) are accepted.

---

## Known Caveats

- Some testnet token addresses are placeholders marked with `⚠️ VERIFY` comments in source
- Stacks sBTC testnet contract address is a placeholder — verify before testnet use
