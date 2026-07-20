# @peelbtc/core — Node.js API Reference

## Import

```javascript
import {
  deriveBitcoinAddress,
  deriveStacksAddress,
  deriveEvmAddress,
  buildIdentityProofMessage,
  hashBitcoinMessage,
  recoverPublicKey,
  buildBridIdentityMap,
  // Recipient recovery (no signing required)
  buildIdentityFromPublicKey,
  recoverPublicKeyFromAddress,
  recoverRecipientIdentity,
  NETWORKS,
  getNetwork,
  getMainnetNetworks,
  getTestnetNetworks,
  ASSETS,
  getAssetsForNetwork,
  getBridgedBtcAssets,
  getAsset,
} from "/Users/eric/Code/Peel/packages/core/dist/index.js";
```

## Address Derivation

All accept a 33-byte compressed secp256k1 public key (`Uint8Array`) and optional `testnet` boolean (default `false`).

### `deriveBitcoinAddress(pubkey, testnet?)`

Returns `{ address: "bc1q...", layer: "bitcoin", namespace: "bip122", format: "p2wpkh", testnet: false }`.

Uses `RIPEMD160(SHA256(compressed_pubkey))` → bech32 encoding with witness version 0.

### `deriveStacksAddress(pubkey, testnet?)`

Returns `{ address: "SP...", layer: "stacks", namespace: "stacks", format: "c32check", testnet: false }`.

Uses `RIPEMD160(SHA256(compressed_pubkey))` → c32check encoding. Mainnet version `22` (`SP`), testnet version `26` (`ST`).

### `deriveEvmAddress(pubkey, testnet?)`

Returns `{ address: "0x...", layer: "evm", namespace: "eip155", format: "eip55", testnet: false }`.

Decompresses to 65-byte uncompressed key, strips `04` prefix, takes `keccak256(X || Y)[12:]`. EIP-55 checksummed.

## Identity Recovery (BRID)

### `buildIdentityProofMessage(address)`

```javascript
buildIdentityProofMessage("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")
// → "BRID Identity Proof:\nBitcoin Address: bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
```

### `hashBitcoinMessage(message)`

Returns 32-byte `Uint8Array`. Computes `SHA256(SHA256( \x18"Bitcoin Signed Message:\n" || varint(len) || message ))`. Throws if message ≥ 253 bytes.

### `recoverPublicKey(address, message, signatureBase64)`

Recovers the 33-byte compressed public key from a 65-byte base64 Bitcoin message signature. Verifies the recovered key matches the claimed address. Throws on mismatch.

Accepts both raw recovery ID (0/1) and BIP137 header bytes (39–42 for P2WPKH bech32).

### `buildBridIdentityMap(address, message, signatureBase64)`

Convenience wrapper: recovers the public key, then derives all three layer addresses.

Returns:
```typescript
interface BridIdentityMap {
  root: string;        // Bitcoin P2WPKH address
  publicKey: string;   // Hex 33-byte compressed pubkey
  derived: DerivedAddress[];  // [bitcoin, stacks, evm]
}
```

---

## Recipient Recovery (no signing required)

Three on-chain recovery paths derive a full BRID identity from a recipient's address
without requiring the recipient to sign anything. The public key is extracted from
existing transaction data on-chain.

| Path | Source | Reliability |
|---|---|---|
| Bitcoin (`bc1q...`) | Compressed pubkey in P2WPKH spending witness | Only if address has spent a UTXO |
| Stacks (`SP...`/`ST...`) | ECDSA recovery from any signed tx via Hiro API | Any address that has sent a tx |
| EVM (`0x...`) | ECDSA recovery from any signed tx via RPC/explorer | Any address that has sent a tx — see `@peelbtc/sdk` |

Limitation: receive-only addresses that have never sent a tx have not revealed
their public key on-chain and cannot be recovered. The BRID signing step is still
needed for those.

### `recoverRecipientIdentity(address, options?)`

High-level: recovers pubkey from a Bitcoin or Stacks address and returns a full
`BridIdentityMap` (Bitcoin + Stacks + all EVM addresses derived from the same key).
Returns `null` if recovery fails.

```typescript
const identity = await recoverRecipientIdentity("SPET5CSE...")
// identity.publicKey — recovered compressed pubkey
// identity.root — bitcoin address
// identity.derived — [bitcoin, stacks, bob, rootstock, citrea]
```

### `recoverPublicKeyFromAddress(address, options?)`

Lower-level: returns the raw 33-byte compressed pubkey as `Uint8Array`, or `null`.

```typescript
const pubkey = await recoverPublicKeyFromAddress("bc1qrk3...") // Bitcoin
const pubkey = await recoverPublicKeyFromAddress("SP1..."    ) // Stacks
```

Options (`RecipientRecoveryOptions`):
- `hiroBaseUrl` — Hiro API base URL (default: `https://api.hiro.so`)
- `bitcoinApiUrl` — mempool.space base URL (default: `https://mempool.space/api`)
- `testnet` — use testnet APIs

### `buildIdentityFromPublicKey(pubkey, testnet?)`

Pure function (no network). Given a 33-byte compressed pubkey (`Uint8Array` or hex string),
returns a full `BridIdentityMap`. Use this after any recovery path to build the identity.

```typescript
const identity = buildIdentityFromPublicKey("0365b706...", false)
// Same result as BRID signing, but derived directly from the known pubkey
```

**EVM recipient recovery** lives in `@peelbtc/sdk` — see `sdk.md` →
`recoverEvmRecipientIdentity` / `recoverPublicKeyFromEvmAddress`.

### `NETWORKS` / `getNetwork(id)` / `getMainnetNetworks()` / `getTestnetNetworks()`

Static registry of supported chains (Bitcoin, Stacks, BOB, Rootstock, Citrea — mainnet + testnet).

### `ASSETS` / `getAssetsForNetwork(networkId)` / `getBridgedBtcAssets()` / `getAsset(id)`

Static registry of BTC and bridged BTC assets across all supported networks.

## Types

All address functions return `DerivedAddress`:

```typescript
interface DerivedAddress {
  address: string;    // Encoded address string
  layer: string;      // "bitcoin" | "stacks" | "evm"
  namespace: string;  // "bip122" | "stacks" | "eip155"
  format: string;     // "p2wpkh" | "c32check" | "eip55"
  testnet: boolean;
}
```
