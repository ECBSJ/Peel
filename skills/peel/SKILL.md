---
name: peel
description: "Derive Bitcoin L2 addresses (Stacks, EVM, Bitcoin P2WPKH) from a single secp256k1 public key using BRID (Bitcoin-Rooted Identity Derivation). Use when: deriving layer addresses from a Bitcoin wallet, recovering a public key from a Bitcoin message signature, building a BRID identity map, or working with @peelbtc/core."
---

# Peel — Bitcoin-Rooted Identity Derivation (BRID)

Derive Stacks, EVM, and Bitcoin P2WPKH addresses from a single compressed secp256k1 public key. Recover the public key from a Bitcoin message signature when the wallet can't expose it directly.

## When to use

Use this skill when the user asks to:

- Derive Bitcoin L2 addresses (Stacks, EVM) from a Bitcoin wallet or public key
- Build a BRID identity map from a Bitcoin address + message signature
- Recover a secp256k1 public key from a Bitcoin message signature
- Hash a message using Bitcoin's message signing format
- Work with `@peelbtc/core` in code

## Prerequisites

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

See `./references/node.md` for detailed API documentation.
