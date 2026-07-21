# @peelbtc/core

Pure-crypto address derivation and identity recovery for the Peel protocol. No chain SDKs, no network calls, no side effects.

Part of the [Peel](https://github.com/ECBSJ/Peel) monorepo — a Payments Engine for Every Layer.

## Install

```bash
npm install @peelbtc/core@alpha
```

## What it does

Implements **BRID (Bitcoin-Rooted Identity Derivation)** — a standard for deriving all Bitcoin L2 addresses from a single secp256k1 public key. One key, every layer.

```
compressed secp256k1 pubkey (33 bytes)
    ├── Bitcoin   → P2WPKH bech32 (bc1q...)
    ├── Stacks    → c32check (SP...)         ← same hash160 as Bitcoin
    └── EVM       → EIP-55 (0x...)           ← shared across BOB, Rootstock, Citrea
```

## API

### Address derivation

```ts
import { deriveBitcoinAddress, deriveStacksAddress, deriveEvmAddress } from "@peelbtc/core";

const bitcoin = deriveBitcoinAddress(pubkeyBytes);  // { address: "bc1q...", layer: "bitcoin", ... }
const stacks  = deriveStacksAddress(pubkeyBytes);   // { address: "SP...",  layer: "stacks",  ... }
const evm     = deriveEvmAddress(pubkeyBytes);       // { address: "0x...",  layer: "evm",     ... }
```

### BRID identity from a Bitcoin message signature

```ts
import { buildBridIdentityMap, buildIdentityProofMessage } from "@peelbtc/core";

const message  = buildIdentityProofMessage("bc1q...");
// → wallet signs message, returns 65-byte base64 signature

const identity = buildBridIdentityMap("bc1q...", message, sigBase64);
// identity.publicKey — 33-byte compressed pubkey (hex)
// identity.derived   — [bitcoin, stacks, bob, rootstock, citrea]
```

### Identity from a known public key (no signing)

```ts
import { buildIdentityFromPublicKey } from "@peelbtc/core";

const identity = buildIdentityFromPublicKey("0265b706...");
```

### On-chain recipient recovery (no signing required)

Recover a full identity from a recipient's existing transaction history:

```ts
import { recoverRecipientIdentity } from "@peelbtc/core";

// Works for Bitcoin (bc1q...) and Stacks (SP...) addresses
const identity = await recoverRecipientIdentity("SP1...");
// Returns null if address has no transaction history
```

For EVM (0x...) recipients, use `recoverEvmRecipientIdentity` from `@peelbtc/sdk`.

## License

MIT
