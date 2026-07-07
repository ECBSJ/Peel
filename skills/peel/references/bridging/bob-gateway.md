# BOB Gateway CLI — BTC Bridge Reference

## What it is

BOB Gateway CLI is a cross-chain swap engine for native Bitcoin. It moves BTC to and from EVM chains in a single Bitcoin transaction — non-custodial, no SDK binding, no language lock-in.

It is the bridge layer that complements Peel's EVM execution layer:

| Step | Tool |
|---|---|
| BTC → wBTC on BOB (bridge in) | Gateway CLI |
| wBTC transfer on BOB (EVM send) | Peel SDK (`buildBobTokenTransfer`) |
| wBTC → BTC (bridge out) | Gateway CLI |

## Install

```bash
npm install -g @gobob/gateway-cli
gateway-cli --help
```

## Configuration

All config via environment variables — no config files:

```bash
export BITCOIN_PRIVATE_KEY="<wif-or-hex>"   # BTC signing key
export EVM_PRIVATE_KEY="<hex>"              # EVM signing key
```

When using OWS, pass keys inline with `--private-key` instead, or use `--unsigned` to keep keys entirely out of the CLI (see below).

Optional overrides:

```bash
export GATEWAY_API_URL="..."           # custom Gateway API (default: production)
export BTC_FEE_RATE="5"               # sat/vbyte fee rate (default: mempool fastest)
export EVM_RPC_URL_BOB="..."          # custom BOB RPC
```

## Key commands

### Quote — preview without committing

```bash
gateway-cli quote --src BTC --dst USDC:base --amount 0.05BTC --json
gateway-cli quote --src BTC --dst USDC:base --amount 100USD --json   # USD-denominated
```

Always quote before swapping. The quote shows real slippage, fees, and the exact receive amount.

### Swap — cross-chain bridge

```bash
# Execute swap (signs with env keys)
gateway-cli swap --src BTC --dst USDC:base --amount 0.05BTC --recipient 0xYourAddress

# Agent-safe: return unsigned tx, don't broadcast
gateway-cli swap --src BTC --dst USDC:base --amount 0.05BTC --unsigned --json

# Fire-and-forget: submit and return order ID without waiting for settlement
gateway-cli swap --src BTC --dst USDC:base --amount 0.05BTC --no-wait --json
```

### Send — single-chain transfer (no bridge)

```bash
gateway-cli send --asset ETH:bob --amount 0.01ETH --to 0xRecipient
gateway-cli send --asset BTC --amount 0.01BTC --to bc1qRecipient
gateway-cli send --asset BTC --amount ALL --to bc1qRecipient   # sweep
```

### Balance — check holdings

```bash
gateway-cli balance                          # derives addresses from env keys
gateway-cli balance bc1q... 0x123...         # explicit addresses
gateway-cli balance --chain bob --non-zero   # filter to BOB, non-zero only
```

### Routes — discover what's supported

```bash
gateway-cli routes --json                   # all routes
gateway-cli routes --chains                 # supported chains
gateway-cli routes --tokens bob             # tokens on BOB
gateway-cli routes --src-chain bitcoin      # routes from BTC
```

### Status — track a pending order

```bash
gateway-cli status <order-id> --json
gateway-cli orders <address> --json         # all orders for an address
```

## Amount format

| Format | Example | Meaning |
|---|---|---|
| Token suffix | `0.05BTC` | 0.05 BTC in human units |
| USD | `100USD` | $100 worth (price oracle) |
| Atomic | `5000000` | 5,000,000 satoshis / wei |
| All | `ALL` | Max spendable balance |

Bare numbers are always atomic — `100` means 100 satoshis, not 100 BTC.

## Agent-safe pattern (unsigned mode)

For agents that must not hold private keys, use `--unsigned --json`. The CLI returns an unsigned PSBT (BTC) or unsigned EVM tx without broadcasting. Pass it to OWS or another signer:

```bash
# 1. Get unsigned tx from Gateway
gateway-cli swap --src BTC --dst USDC:base --amount 100USD --unsigned --json

# 2. Sign with OWS (outside the CLI)
# ows sign-transaction --wallet <name> --chain bitcoin --tx <psbt-hex>

# 3. Register the signed tx to complete the order
gateway-cli register <order-id> <signed-txid>
```

## JSON output

Add `--json` to any command for machine-readable output. Errors are also structured JSON.

```bash
gateway-cli quote --src BTC --dst USDC:base --amount 100USD --json
# → { "srcAmount": "94000", "dstAmount": "99830000", ... }
```

## Relationship to Peel

- Peel SDK handles **EVM execution**: once BTC is bridged to BOB as wBTC, use `buildBobTokenTransfer` / `prepareBobTx` / `encodeBobSignedTx` / `broadcastBobTx` to move it on-chain.
- Gateway CLI handles **bridging**: BTC L1 ↔ BOB and BTC L1 ↔ other EVM chains.
- The two tools are complementary. A complete BTC → wBTC transfer on BOB → recipient flow is: Gateway CLI (bridge in) → Peel SDK (EVM send).

## Source

- GitHub: https://github.com/bob-collective/bob/tree/master/gateway-cli
- Docs: https://docs.gobob.xyz/gateway/overview
