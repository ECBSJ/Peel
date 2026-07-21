# Peel — A Payments Engine for Every Layer

> *Send sats, not complexity.*

Peel is a Bitcoin payment routing SDK for Bitcoin L1 and L2s. It abstracts away address formats, transaction models, bridge protocols, and signing conventions behind a single, clean interface.

Describe a payment intent. Peel resolves the route, selects the bridge, checks network health, and returns an ordered execution plan. You sign externally. Peel never holds keys.

```ts
import { routePayment } from "@peelbtc/sdk";
import { buildBridIdentityMap } from "@peelbtc/core";

const identity = buildBridIdentityMap(address, message, sigBase64);

const plan = await routePayment({
  from: identity,
  to: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7", // any chain, any format
  amountSats: 100_000n,
});

// plan.steps[] — ordered execution steps (send BTC, call bridge, broadcast tx, etc.)
// plan.intent  — resolved route, fees, timing, Peel memo
```

---

## The Idea

Bitcoin is the core. Every L2 is a layer wrapped around it — different address formats, different transaction models, different representations of BTC. The further from Bitcoin you go, the more layers accumulate.

Peel strips those layers away. When you use Peel, you think in sats. The layers are invisible.

---

## Packages

```
@peelbtc/types   ← shared interfaces, zero logic
      ↑
@peelbtc/core    ← pure crypto: address derivation, BRID identity, recipient recovery
      ↑
@peelbtc/sdk     ← balances, transactions, bridges, routing engine
      ↑
@peelbtc/mcp     ← MCP server for AI agent integration (v2)
```

| Package | Description | npm |
|---|---|---|
| `@peelbtc/types` | Shared interfaces and enums | [![npm](https://img.shields.io/npm/v/@peelbtc/types)](https://www.npmjs.com/package/@peelbtc/types) |
| `@peelbtc/core` | Address derivation, BRID identity, on-chain recipient recovery | [![npm](https://img.shields.io/npm/v/@peelbtc/core)](https://www.npmjs.com/package/@peelbtc/core) |
| `@peelbtc/sdk` | Routing engine, transactions, bridges, balances | [![npm](https://img.shields.io/npm/v/@peelbtc/sdk)](https://www.npmjs.com/package/@peelbtc/sdk) |

---

## What's inside

### BRID — Bitcoin-Rooted Identity Derivation

All layer addresses derive from a single compressed secp256k1 public key. One key, every layer. No chain-specific keys.

```
pubkey → Bitcoin (bc1q...)   via hash160 → bech32
       → Stacks (SP...)     via hash160 → c32check
       → EVM (0x...)        via keccak256 → EIP-55   (shared: BOB, Rootstock, Citrea)
```

Identity can be established via Bitcoin message signing (BRID proof) or recovered passively from any existing on-chain transaction — no interaction required from the recipient.

### Supported chains

| Network | Type | Address | BTC asset |
|---|---|---|---|
| Bitcoin L1 | L1 | bech32 P2WPKH | BTC |
| Stacks | L2 | c32check | sBTC |
| BOB | L2 EVM | EIP-55 | ETH + wBTC |
| Rootstock | L2 EVM | EIP-55 | RBTC |
| Citrea | L2 EVM | EIP-55 | cBTC |

### Transactions

Each chain has a typed prepare → sign → encode → broadcast pipeline. All signing is external — Peel returns unsigned tx data for your own signer (OWS, MetaMask, etc.).

- **BOB / Citrea** — EIP-1559 (type 2)
- **Rootstock** — legacy type 0, EIP-155 `v` applied automatically
- **Stacks** — secp256k1 (same curve as Bitcoin); signs with `ows sign tx --chain bitcoin`

### Bridges

| Bridge | Route | Protocol |
|---|---|---|
| Rootstock Flyover | BTC ↔ rBTC | @rsksmart/flyover-sdk |
| sBTC | BTC ↔ sBTC on Stacks | Emily API + sBTC Signers |
| BOB Gateway | BTC ↔ ETH/wBTC on BOB | BOB Gateway CLI |

### Routing engine

`routePayment()` resolves the optimal route from a payment intent:

- Detects destination chain from address format
- Checks network liveness before committing
- Scores candidates: sender balance (35%), receiver activity (25%), fee rate (25%), settlement time (15%)
- Embeds a Peel memo (`PEEL | version | intentId | userMemo`) in every transaction for future indexing
- Calls an optional `onIntentResolved` callback for opt-in telemetry

### Recipient recovery

Derive a recipient's full cross-chain identity from any of their on-chain addresses — no signing required:

- **Bitcoin** — compressed pubkey from P2WPKH spending witness
- **Stacks** — ECDSA recovery from any signed transaction
- **EVM** — ECDSA recovery from any signed transaction

---

## Install

**For developers:**

```bash
npm install @peelbtc/sdk@alpha
```

`@peelbtc/core` and `@peelbtc/types` are installed automatically as dependencies.

**For AI agents:**

One command installs the SDK + skills for all detected coding assistants:

```bash
curl -fsSL https://raw.githubusercontent.com/ECBSJ/Peel/main/install.sh | bash
```

This detects and configures GitHub Copilot, Cursor, Claude Code, and 10+ other agents.

---

## Design principles

- **No private keys** — the `SignerAdapter` boundary is a hard security guarantee
- **Bitcoin-native identity** — all addresses from one secp256k1 key, no chain-specific derivation
- **Bigint amounts** — all satoshi values are `bigint`, no floating point
- **Agent-first** — every function returns data the agent acts on; nothing executes without explicit instruction
- **OWS-native** — designed to work with [Open Wallet Standard](https://github.com/ECBSJ/Open-Wallet-Standard) for signing

---

## Development

**Requirements:** Node.js 18+, pnpm 10+

```bash
pnpm install
pnpm build
pnpm test
```

---

## Roadmap

### v0.1.0-alpha (current)

Core payment routing across Bitcoin L1 and L2s. Address derivation, BRID identity, balance orchestration, transactions, bridges, and recipient recovery.

### v1.0 (planned)

- `@peelbtc/mcp` — MCP server for AI agent integration
- Flyover peg-out (Rootstock → Bitcoin) with unsigned-first pattern
- Citrea peg-in bridge
- L2→L2 multi-hop routing
- ERC-20 memo relay contract
- Receive-only address BRID signing alternative

---

## Support & Feedback

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/ECBSJ/Peel/issues).

---

## License

MIT
