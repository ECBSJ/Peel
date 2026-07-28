# Peel — A Payments Engine for Every Layer

> *Send sats, not complexity.*

![Peel](assets/Concept-v4-Cover.png)

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

```mermaid
graph LR
    A["Developer<br/>routePayment()"] --> B["Peel<br/>Routing Engine"]
    B --> C["Analyze<br/>Address & Networks"]
    C --> D["Score &<br/>Select Route"]
    D --> E{Destination?}
    E --> F["BTC"]
    E --> G["sBTC"]
    E --> H["wBTC"]
    E --> I["rBTC"]
    E --> J["cBTC"]
    E --> K["Any L2<br/>Wrapped BTC"]
    F --> L["Execution Plan<br/>steps, fees, timing"]
    G --> L
    H --> L
    I --> L
    J --> L
    K --> L
    L --> M["Developer Signs<br/>External Signer"]
    M --> N["Broadcast &<br/>Settle"]
    
    style A stroke:none,fill:none
    style B stroke:none,fill:none
    style C stroke:none,fill:none
    style D stroke:none,fill:none
    style E stroke:none,fill:none
    style F stroke:none,fill:none
    style G stroke:none,fill:none
    style H stroke:none,fill:none
    style I stroke:none,fill:none
    style J stroke:none,fill:none
    style K stroke:none,fill:none
    style L stroke:none,fill:none
    style M stroke:none,fill:none
    style N stroke:none,fill:none
```

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

## Usage Examples

### Fetch BTC-denominated balances across all layers

```
❯ how much in total btc do i have

[agent thinking]
  Using Peel's @peelbtc/core BRID identity derivation...
    → your pubkey derives to 5 addresses (1 Bitcoin + 4 EVM + 1 Stacks)
  
  Using Peel's @peelbtc/sdk balance orchestration...
    → querying Bitcoin L1: 99,792 sats
    → querying Stacks sBTC: 34,584 sats
    → querying BOB wBTC: 40,849 sats
    → querying Rootstock rBTC: ~99,946 sats
    → querying Citrea cBTC: ~39,209 sats
  
  Converting all L2 representations to BTC-denominated total...
    → 1:1 parity preserved across all layers
    → total: 314,380 sats (0.00314380 BTC) ✓

Total BTC-denominated balance: 314,380 sats (0.00314380 BTC) across your BRID identity.

┌───────────┬───────┬──────────────┐
│ Layer     │ Asset │      Balance │
├───────────┼───────┼──────────────┤
│ Bitcoin   │ BTC   │  99,792 sats │
│ Stacks    │ sBTC  │  34,584 sats │
│ BOB       │ wBTC  │  40,849 sats │
│ Rootstock │ rBTC  │ ~99,946 sats │
│ Citrea    │ cBTC  │ ~39,209 sats │
└───────────┴───────┴──────────────┘
```

**What's happening here:** Peel is querying your BRID identity across all supported chains, fetching balances from each layer, and aggregating them into a single BTC-denominated total. Each row represents a different L2 with the same underlying Bitcoin value.

### Send sats to any address (auto-routed)

```
❯ send 15,000 sats to 0x388C818CA8B9251b393131C08a736A67ccB19297

[agent thinking]
  Using Peel's address format detection (@peelbtc/core)...
    → 0x prefix + 40 hex chars = EVM address
    → probable chain: Rootstock (most common routing)
  
  Checking your sender balance across layers...
    → Bitcoin: 99,792 sats (available)
    → rBTC on Rootstock: 99,946 sats (available) ✓
  
  Using Peel's routing engine to score routes...
    ✓ Direct Rootstock: sender balance 99,946 sats > 15,000 (score: 92/100)
      • No bridge required (fee: ~54 sats)
      • Settlement: ~30 seconds
    ⊘ Bridge from Bitcoin: would require crossing, higher fee
  
  Route selected: Direct Rootstock (optimal)

Payment of 15,000 sats has been sent to 0x388C818CA8B9251b393131C08a736A67ccB19297.

Route: Direct Rootstock transfer — no Flyover bridge
Fee: ~54 sats  |  Settlement: ~30 seconds
Transaction: 0xae10b8b8cf491b4f8d2d7d5ef65e37588b67a8e5cfd376e96854051dcd1b7423
```

**What's happening here:** Peel detected the destination as an EVM address (Rootstock), checked that you have enough rBTC there, and routed directly without crossing a bridge. The recipient has an active rBTC balance on that chain, so Peel scored that as the optimal path.

### Send sats to cold storage (Bitcoin L1)

```
❯ send 21,000 sats to 0xC791fEA344eb7e0cC7D3C04956803168B3ea814a. the recipient would like to hodl these sats in cold storage.

[agent thinking]
  Parsing intent from natural language...
    → detected: "cold storage" = hodl intent
    → desired chain: Bitcoin L1 (preferred for cold storage)
  
  Using Peel's recipient recovery (@peelbtc/core)...
    → recovering from EVM address via ECDSA signature recovery
    → Bitcoin address: bc1q89zqat5x9cye7v2uwun2ds7980p25n02g7g90w ✓
  
  Using Peel's routing engine with intent scoring...
    → intent: "cold storage" weights Bitcoin L1 at +40% priority
    ✓ Bitcoin L1: native chain, longest settlement, most secure
    ⊘ L2 routes: bypassed due to cold storage intent
  
  Route selected: Direct Bitcoin L1 native payment

21,000 sats have been sent to 0xC791fEA344eb7e0cC7D3C04956803168B3ea814a.

Route: Direct native Bitcoin payment
Bitcoin recipient: bc1q89zqat5x9cye7v2uwun2ds7980p25n02g7g90w
Amount: 21,000 sats
Fee: 200 sats
Transaction: b97465f0d3094b0f1d557d1fe499865060fd241e1f95cdef48b11f9ac88499a5
```

**What's happening here:** Peel recovered the recipient's Bitcoin address from their EVM pubkey, detected the "cold storage" intent, and routed to native Bitcoin L1 instead of a wrapped asset on an L2.

### Send BTC via bridge to a recipient on another chain

```
❯ send 50,000 sats to 0x8F7A3d3F3d3F3d3F3d3F3d3F3d3F3d3F3d3F3d3F

[agent thinking]
  Recovering cross-chain identity from EVM address...
    → deriving from keccak256 hash of secp256k1 pubkey
    → Bitcoin address: bc1qm8mxc6c9n7q9v8e7d6c5b4a3z2y1x0w9v8u7t
    → Stacks address: SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7 ✓
  
  Analyzing recipient on-chain activity...
    → Stacks sBTC balance: 145,000 sats (active)
    → Bitcoin balance: 8,500 sats (minimal)
    → BOB wBTC balance: 2,100 sats (inactive for 6mo)
    → Pattern: recipient is avid Stacks user, heavy sBTC activity ✓
  
  Evaluating routes by recipient preference & balance...
    ⊘ Bitcoin L1: insufficient context for cold storage intent
    ✓ sBTC bridge: optimal — native chain, active user, healthy sBTC balance

50,000 sats have been sent to 0x8F7A3d3F3d3F3d3F3d3F3d3F3d3F3d3F3d3F3d3F.

Route: BTC → sBTC peg-in via Stacks bridge
Stacks recipient: SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7
Asset: sBTC
Fee: 1,200 sats
Settlement: ~20 minutes
Transaction: b8a4e6f2c1d5a9e3f7b2c6d9e1f4a8c2d5e8f1a4b7c0d3e6f9a2b5c8e1f4a7
```

**What's happening here:** Peel recovered the recipient's cross-chain identity, analyzing their activity on each layer. It detected that they're an active Stacks user with a healthy sBTC balance, so it selected the sBTC peg-in bridge as the optimal route. The agent shows its reasoning: why this route was chosen over alternatives, all before execution.

---

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
