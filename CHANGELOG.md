# Changelog

All notable changes to the Peel monorepo are documented here.

---

## [0.1.0-alpha.2] — 2026-07-21

- Added `README.md` to all published packages (`@peelbtc/types`, `@peelbtc/core`, `@peelbtc/sdk`)
- Fixed npm `latest` dist-tag to point to `0.1.0-alpha.2`
- No code changes from `0.1.0-alpha.1`

---

## [0.1.0-alpha.1] — 2026-07-20

Initial alpha release. Early testers only.

### Packages

- `@peelbtc/types` — shared interfaces, no logic
- `@peelbtc/core` — pure crypto: address derivation, BRID identity recovery
- `@peelbtc/sdk` — balance orchestration, transaction helpers, bridges, routing engine

---

### `@peelbtc/core`

**BRID Identity (Bitcoin-Rooted Identity Derivation)**

- `deriveBitcoinAddress(pubkey, testnet?)` — P2WPKH bech32 from compressed secp256k1 key
- `deriveStacksAddress(pubkey, testnet?)` — c32check from the same key (same hash160 as Bitcoin)
- `deriveEvmAddress(pubkey, testnet?)` — EIP-55 checksummed EVM address; shared across BOB, Rootstock, Citrea
- `buildIdentityProofMessage(address)` — canonical BRID Identity Proof message for signing
- `hashBitcoinMessage(message)` — Bitcoin message hash (double-SHA256 with magic prefix)
- `recoverPublicKey(address, message, sigBase64)` — recover compressed pubkey from Bitcoin message signature
- `buildBridIdentityMap(address, message, sigBase64)` — full cross-chain identity map from a signed message
- `buildIdentityFromPublicKey(pubkey, testnet?)` — build identity map from a known pubkey, no signing required

**Recipient recovery (no signing required)**

- `recoverPublicKeyFromAddress(address, options?)` — recover compressed pubkey from Bitcoin or Stacks address via on-chain tx data
- `recoverRecipientIdentity(address, options?)` — recover full BRID identity map from Bitcoin or Stacks address

**Registry**

- `NETWORKS` — static chain registry (Bitcoin, Stacks, BOB, Rootstock, Citrea — mainnet + testnet)
- `ASSETS` — static BTC asset registry across all supported networks

---

### `@peelbtc/sdk`

**Balances**

- `fetchBalances(identity, overrides?)` — fetch BTC-denominated balances across all supported layers in parallel
  - Layers: Bitcoin L1, Stacks (STX + sBTC), BOB (ETH + wBTC), Rootstock (RBTC), Citrea (cBTC)
  - Failures on individual chains do not block others

**Transactions — BOB (EIP-1559, type 2)**

- `buildBobEthTransfer` / `buildBobTokenTransfer` — native ETH and ERC-20 (wBTC) transfer intents
- `prepareBobTx` / `serializeBobTx` / `encodeBobSignedTx` / `broadcastBobTx` — full tx pipeline

**Transactions — Rootstock (legacy type 0)**

- `buildRootstockTransfer` — native RBTC transfer intent
- `prepareRootstockTx` / `serializeRootstockTx` / `encodeRootstockSignedTx` / `broadcastRootstockTx`
- Note: use `ows sign tx --chain evm` (not `send-tx`). EIP-155 `v` encoding applied automatically.

**Transactions — Citrea (EIP-1559, type 2)**

- `buildCitreaTransfer` / `prepareCitreaTx` / `serializeCitreaTx` / `encodeCitreaSignedTx` / `broadcastCitreaTx`

**Transactions — Stacks (secp256k1, same curve as Bitcoin)**

- `buildStxTransfer` / `buildSbtcTransfer` — STX native and sBTC SIP-010 transfer intents
- `prepareStacksTx` / `encodeStacksSignedTx` / `broadcastStacksTx`
- Signing: `ows sign tx --chain bitcoin --tx <preSignSigHash>` — payload is pre-hashed, no re-hashing
- Peel memo embedded via SIP-010 `transfer(amount, sender, recipient, memo)` optional buff param

**Bridges — Rootstock Flyover (BTC ↔ rBTC)**

- `RootstockFlyoverBridgeAdapter` — wraps `@rsksmart/flyover-sdk`
- `getPegInPaymentPlan(amountSats, recipientRskAddress)` — returns BTC payment info + LP signature
- `validatePegInTransaction(plan, rawBtcTxHex)` — validate BTC tx before broadcasting
- `registerPegIn(plan, userBtcTxHash)` — recovery path (requires `connectToBitcoin` + `connectToRsk`)
- `getRegisterPegInInfo(plan, txHash)` — return RSK call params without executing
- `getPegoutQuote` / `depositPegout` / `pollStatus` / `getPegoutStatus`
- `FLYOVER_LBC_ADDRESS` / `FLYOVER_LIMITS` — contract addresses and protocol limits
- Auto-selects captcha-free LPs (`preferNoCaptcha: true` default)

**Bridges — sBTC (BTC ↔ sBTC on Stacks, mainnet only)**

- `buildSbtcDepositPlan(opts)` — fetch Signers pubkey, build P2TR deposit address
- `notifySbtcDeposit(plan, btcTxHex)` — notify Emily API after BTC broadcast
- `pollSbtcDepositStatus(btcTxid)` — poll Emily API for mint confirmation
- `prepareSbtcWithdrawalTx(opts)` — build unsigned Stacks `initiate-withdrawal-request` call
- `pollSbtcWithdrawalStatus(stacksAddress)` — poll Emily API for withdrawal status
- `decodeBtcAddress(address)` — decode any BTC address to Clarity `{version, hashbytes}` tuple

**Routing engine**

- `routePayment(intent)` — resolve the optimal route for a payment intent
  - Destination address resolution: Bitcoin, Stacks, EVM (0x...) all supported
  - Scoring: sender balance (35), receiver activity (25), fee rate (25), settlement time (15)
  - Liveness checks: 5-second RPC ping per chain before committing
  - Receiver heuristic: infers preferred EVM chain from recipient balance profile
  - Peel memo: `PEEL(4) | version(1) | intentId(16) | userMemo(0-13)` embedded in every tx
  - Intent reporter: opt-in `onIntentResolved` callback for telemetry
  - Supported routes: Bitcoin↔Stacks (sBTC), Bitcoin↔Rootstock (Flyover), Bitcoin↔BOB (Gateway), direct transfers on all chains
  - Citrea: direct transfers only (no programmatic bridge in v1)
  - L2→L2 multi-hop: deferred to v2

**EVM recipient recovery**

- `recoverEvmRecipientIdentity(address, options)` — recover full BRID identity from any EVM address with tx history
- `recoverPublicKeyFromEvmAddress(address, options)` — recover compressed pubkey from EVM address

**Peel memo constants**

- `PEEL_MEMO_MAGIC` — `[0x50, 0x45, 0x45, 0x4c]` ("PEEL")
- `PEEL_MEMO_VERSION` — `0x01`
- `encodePeelMemo(intentId, userMemo?)` — encode a Peel memo for embedding in any tx

---

### Known limitations (v2 backlog)

- `@peelbtc/mcp` MCP server — stub only, not yet implemented
- Flyover peg-out (`depositPegout`) requires an active RSK signer connection — unsigned-first pattern deferred
- Citrea peg-in: no programmatic bridge available
- L2→L2 routing: not supported (requires two bridge hops)
- ERC-20 (wBTC) memo: omitted — `data` field occupied by ABI calldata; relay contract needed for v2
- Recipient recovery for receive-only addresses (never spent): still requires BRID signing step

---

### Integration tests

All tests run against live networks and are gated by `process.env.CI`:

| Test file | Network | Status |
|---|---|---|
| `rootstock.integration.test.ts` | Rootstock mainnet + testnet | ✅ 5/5 |
| `stacks.integration.test.ts` | Stacks testnet | ✅ 6/6 |
| `citrea.integration.test.ts` | Citrea testnet | ✅ balance; broadcast needs cBTC faucet |
| `recover-recipient.integration.test.ts` | Bitcoin, Stacks, BOB mainnet | ✅ 8/8 |
| `bob.integration.test.ts` | BOB mainnet | balance ✅; broadcast needs wBTC balance |
