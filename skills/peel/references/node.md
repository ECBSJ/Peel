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

## Registry

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
