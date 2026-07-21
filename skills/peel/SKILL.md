---
name: peel
description: "Use the Peel SDK to route Bitcoin payments across L1 and L2s, derive layer addresses via BRID, fetch multi-chain balances, and build/sign/broadcast EVM transactions. Use when: working with @peelbtc/core (identity derivation), @peelbtc/sdk (balances, BOB transfers), or integrating OWS signing with Peel's EVM encoding path."
---

# Peel — A Payments Engine for Every Layer

Peel is a unified Bitcoin payment routing SDK. Developers describe what they want to pay — Peel figures out which network, which asset, and how to route it. The goal is for callers to think in sats, not in chain-specific mechanics.

> *Send sats, not complexity.*

## Product Context

Bitcoin's L2 ecosystem fragments identity, addresses, and BTC representations across multiple chains. Peel's job is to abstract that away through three ideas:

1. **Bitcoin-native identity (BRID)** — all chain addresses derive from a single secp256k1 public key rooted in a Bitcoin P2WPKH address. No chain-specific keys.
2. **Balance orchestration** — fetch BTC-denominated balances across all supported layers in one call.
3. **Transaction routing** — build, sign, and broadcast transactions on each chain without exposing private keys.

## Package Boundaries

```
@peelbtc/types   ← shared interfaces, zero logic
      ↑
@peelbtc/core    ← pure crypto: address derivation, BRID identity recovery
      ↑
@peelbtc/sdk     ← balance orchestration, chain adapters, transaction helpers
      ↑
@peelbtc/mcp     ← MCP server for AI agent payment routing (planned)
```

Each package only imports from packages below it. `@peelbtc/core` has no chain SDK dependencies.

## Security Constraints

- Peel never handles private keys — signing always happens outside the SDK via a signer (OWS, MetaMask, etc.)
- The `SignerAdapter` boundary is a hard guarantee — Peel receives unsigned tx bytes, passes them to the signer, and receives a signature back

## When to Use Which Package

| Task | Package |
|------|---------|
| Derive Bitcoin / Stacks / EVM address from pubkey | `@peelbtc/core` |
| Recover pubkey from a Bitcoin message signature | `@peelbtc/core` |
| Build a BRID identity map from OWS wallet | `@peelbtc/core` |
| Fetch balances across all layers | `@peelbtc/sdk` |
| Build + broadcast a BOB ERC-20 transfer | `@peelbtc/sdk` |
| Route a payment intent | `@peelbtc/sdk` (planned) |

## When to use this skill

Use this skill when the user asks to:

- Derive Bitcoin L2 addresses (Stacks, EVM) from a Bitcoin wallet or public key
- Build a BRID identity map from a Bitcoin address + message signature
- Recover a secp256k1 public key from a Bitcoin message signature
- Hash a message using Bitcoin's message signing format
- Fetch multi-layer BTC balances
- Build or broadcast a BOB wBTC transfer with OWS signing
- Work with `@peelbtc/core` or `@peelbtc/sdk` in code

## Prerequisites

### Signing tool (required)

Peel never handles private keys. All transaction signing is done externally by a key management tool.

**Recommended: Open Wallet Standard (OWS)**

```bash
curl -fsSL https://docs.openwallet.sh/install.sh | bash
```

All signing examples throughout these docs use OWS commands (`ows sign tx`, `ows wallet info`, etc.). Any compatible tool must be able to:

- Expose a **33-byte compressed secp256k1 public key** (hex, no `0x` prefix)
- Sign raw tx hex with `--chain bitcoin` (Stacks, Bitcoin) or `--chain evm` (BOB, Rootstock, Citrea)
- Return a 65-byte signature as `r(32) || s(32) || v(1)` hex

### Peel SDK

- The Peel SDK must be built: `cd /Users/eric/Code/Peel && pnpm --filter @peelbtc/core build`
- Import from the dist path: `/Users/eric/Code/Peel/packages/core/dist/index.js`
- All code must use `--input-type=module` or be inside an ESM context

## Package Location

```
/Users/eric/Code/Peel/packages/core/dist/index.js
```

## Exported API

| Function | Input | Output |
|----------|-------|--------|
| `deriveBitcoinAddress(pubkey, testnet?)` | 33-byte compressed pubkey | `{ address, layer, namespace, format, testnet }` |
| `deriveStacksAddress(pubkey, testnet?)` | 33-byte compressed pubkey | `{ address, layer, namespace, format, testnet }` |
| `deriveEvmAddress(pubkey, testnet?)` | 33-byte compressed pubkey | `{ address, layer, namespace, format, testnet }` |
| `buildIdentityProofMessage(address)` | Bitcoin P2WPKH address string | BRID message string |
| `hashBitcoinMessage(message)` | Plain text message | 32-byte double-SHA256 hash |
| `recoverPublicKey(address, message, sigBase64)` | Address + message + 65-byte sig (base64) | 33-byte compressed pubkey |
| `buildBridIdentityMap(address, message, sigBase64)` | Address + message + 65-byte sig (base64) | `BridIdentityMap` JSON |

## Procedures

### Derive addresses from a known public key

When the user already has a 33-byte compressed public key (hex string):

```javascript
import {
  deriveBitcoinAddress,
  deriveStacksAddress,
  deriveEvmAddress,
} from "/Users/eric/Code/Peel/packages/core/dist/index.js";

// Convert hex to Uint8Array
const pubkeyHex = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const pubkey = Uint8Array.from(pubkeyHex.match(/.{2}/g).map(b => parseInt(b, 16)));

const bitcoin = deriveBitcoinAddress(pubkey);
const stacks  = deriveStacksAddress(pubkey);
const evm     = deriveEvmAddress(pubkey);

console.log(JSON.stringify({ bitcoin, stacks, evm }, null, 2));
```

### Derive addresses from an OWS wallet (full BRID flow)

When the user has an OWS wallet and wants all layer addresses:

**Step 1 — Get the Bitcoin address:**
```bash
ows wallet info --wallet "<wallet-name>" --json
```
Extract the `bitcoin` address from the output.

**Step 2 — Sign the BRID Identity Proof message:**
```bash
ows sign message --wallet "<wallet-name>" --chain bitcoin \
  --message "BRID Identity Proof:\nBitcoin Address: <address>" --json
```

**Step 3 — Build the identity map:**

The OWS signature is `r(32) || s(32) || recovery_id(1)`. It must be rotated to noble format `recovery_id(1) || r(32) || s(32)` before base64 encoding.

```javascript
import { buildBridIdentityMap } from "/Users/eric/Code/Peel/packages/core/dist/index.js";

// From OWS --json output:
const owsSig = {
  recovery_id: 0,
  signature: "<65-byte hex from OWS>"
};

// Rotate: OWS emits r||s||recovery, noble expects recovery||r||s
const sigBytes = Uint8Array.from(owsSig.signature.match(/.{2}/g).map(b => parseInt(b, 16)));
const rotated = new Uint8Array([sigBytes[64], ...sigBytes.subarray(0, 64)]);
const sigBase64 = btoa(String.fromCharCode(...rotated));

const address = "<bitcoin-address>";
const message = `BRID Identity Proof:\nBitcoin Address: ${address}`;

const identityMap = buildBridIdentityMap(address, message, sigBase64);
console.log(JSON.stringify(identityMap, null, 2));
```

### Expected output shape

```json
{
  "root": "bc1q...",
  "publicKey": "02...",
  "derived": [
    { "address": "bc1q...", "layer": "bitcoin",   "namespace": "bip122",  "format": "p2wpkh",   "testnet": false },
    { "address": "SP...",   "layer": "stacks",    "namespace": "stacks",  "format": "c32check", "testnet": false },
    { "address": "0x...",   "layer": "bob",       "namespace": "eip155",  "format": "eip55",    "testnet": false },
    { "address": "0x...",   "layer": "rootstock", "namespace": "eip155",  "format": "eip55",    "testnet": false },
    { "address": "0x...",   "layer": "citrea",    "namespace": "eip155",  "format": "eip55",    "testnet": false }
  ]
}
```

Note: the three EVM L2 addresses are always identical — they share the same derivation rule. They are listed separately to make the chain context explicit.

## Signature format notes

Two header byte formats are accepted:

- **Raw recovery ID (0 or 1):** Used by `@noble/curves`, OWS. No transformation needed.
- **BIP137 (27–42):** Used by Sparrow, Electrum, Ledger, Trezor. Only P2WPKH bech32 range (39–42) is accepted — others are rejected. The header byte is automatically normalized to a raw recovery ID.

## OWS byte layout reminder

OWS `sign message --json` output:
- `signature`: 65-byte hex = `r(32) || s(32) || recovery_id(1)` — recovery byte at the **end**
- Noble/Peel expects: `recovery_id(1) || r(32) || s(32)` — recovery byte at the **start**
- Rotation: `new Uint8Array([sigBytes[64], ...sigBytes.subarray(0, 64)])`

## Full reference

- `./references/core.md` — `@peelbtc/core` API: address derivation, BRID identity recovery, registry
- `./references/sdk.md` — `@peelbtc/sdk` API: balance orchestration, transaction helpers (BOB, Rootstock, Citrea, Stacks)
- `./references/router.md` — `routePayment()`: routing engine, step types, scoring, Peel memo, execution examples
- `./references/bridging/bob-gateway.md` — BOB Gateway CLI: BTC ↔ EVM bridge, unsigned mode for agent signing, relationship to Peel SDK
- `./references/bridging/rootstock-flyover.md` — Rootstock Flyover: BTC ↔ rBTC bridge via LP liquidity, peg-in/peg-out flows, validation, recovery, limits
- `./references/bridging/sbtc.md` — sBTC Bridge: BTC ↔ sBTC on Stacks (mainnet), peg-in deposit plan + Emily notify, peg-out Stacks contract call, reclaimPublicKey derivation
