# @peelbtc/types

Shared TypeScript interfaces for the Peel protocol. Zero logic, zero dependencies.

Part of the [Peel](https://github.com/ECBSJ/Peel) monorepo — a Payments Engine for Every Layer.

## Install

```bash
npm install @peelbtc/types@alpha
```

## What's in here

This package contains the core interfaces consumed across `@peelbtc/core` and `@peelbtc/sdk`:

- `DerivedAddress` — a cross-chain address derived from a secp256k1 public key
- `LayerBalance` — a BTC-denominated balance entry for a specific chain and asset
- `BalanceMap` — the full multi-chain balance result from `fetchBalances`
- `NetworkConfig` / `AssetConfig` — chain and asset registry types
- `Caip2` — CAIP-2 chain IDs for all supported Bitcoin L2s
- `BridgeAdapter` / `SignerAdapter` — interfaces for bridge and signing integrations

## Usage

```ts
import type { LayerBalance, BalanceMap, DerivedAddress } from "@peelbtc/types";
```

## Part of Peel

| Package | Purpose |
|---|---|
| `@peelbtc/types` | Shared interfaces (this package) |
| `@peelbtc/core` | Address derivation, BRID identity recovery |
| `@peelbtc/sdk` | Balances, transactions, bridges, routing engine |

## License

MIT
