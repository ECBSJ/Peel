# Peel — A Payments Engine for Every Layer

> *Send sats, not complexity.*

Peel is a unified Bitcoin payment routing SDK. It abstracts away the fragmentation of Bitcoin's Layer 1 and Layer 2 ecosystem — different address formats, transaction models, and wrapped BTC representations — into a single, clean developer interface.

Developers describe what they want to pay. Peel figures out how.

```ts
import { send } from "@peelbtc/sdk"

await send({
  to: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  amount: 100_000n // sats
})
```

---

## The Idea

Bitcoin is the core. Every L2, every wrapped asset, every execution environment is a layer wrapped around it — much like the peel of an orange wrapped around the fruit inside. The further from Bitcoin you go, the more layers accumulate: different address formats, different transaction models, different representations of BTC.

Peel's job is to strip those layers away and expose what's underneath. When you use Peel, you're not thinking about Stacks, BOB, or Rootstock — you're thinking in sats. The layers become invisible.

---

## Packages

```
@peelbtc/types   ← shared interfaces, zero logic
      ↑
@peelbtc/core    ← pure crypto: address derivation, identity recovery
      ↑
@peelbtc/sdk     ← routing engine, chain adapters, bridge adapters, signer adapters
      ↑
@peelbtc/mcp     ← MCP server for AI agent integration
```

| Package | Description | Status |
|---|---|---|
| [`@peelbtc/types`](./packages/types) | Shared interfaces and enums — zero logic | ✅ |
| [`@peelbtc/core`](./packages/core) | Address derivation, BRID identity recovery | ✅ |
| [`@peelbtc/sdk`](./packages/sdk) | Routing engine, chain adapters, signer adapters | 🚧 |
| [`@peelbtc/mcp`](./packages/mcp) | MCP server for AI agent payment routing | 🚧 |

---

## Supported Networks

| Network    | Type       | Address Format | BTC Asset    |
|------------|------------|----------------|--------------|
| Bitcoin L1 | L1         | bech32 P2WPKH  | BTC          |
| Stacks     | L2 (VM)    | c32check       | sBTC         |
| BOB        | L2 (EVM)   | EIP-55         | BTC (native) |
| Rootstock  | L2 (EVM)   | EIP-55         | rBTC         |
| Citrea     | L2 (EVM)   | EIP-55         | cBTC         |

---

## Design Principles

- **Bitcoin-native identity** — all chain addresses derive from a single secp256k1 compressed public key. No chain-specific keys.
- **No private keys in the SDK** — Peel never touches a private key. The `SignerAdapter` boundary is a hard security guarantee.
- **Caller-provided UTXOs and nonces** — Peel never fetches wallet state. Callers supply UTXOs (Bitcoin L1) and nonces (EVM chains).
- **Bigint amounts** — all satoshi values are `bigint`. No floating point.
- **Pluggable adapters** — networks, bridges, and signers are all pluggable via interfaces in `@peelbtc/types`.
- **AI-native** — `@peelbtc/mcp` exposes Peel as an MCP server so AI agents can route payments directly.

---

## Development

**Requirements:** Node.js 20+, pnpm 10+

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test
```

---

## License

MIT
