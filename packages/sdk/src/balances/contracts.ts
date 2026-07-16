// ---------------------------------------------------------------------------
// Contract address constants for token balance fetching
//
// These addresses are used by the balance fetchers to query token balances
// via contract calls (ERC-20 balanceOf, SIP-010 get-balance).
//
// ⚠️  VERIFY BEFORE PRODUCTION USE:
//   - TBTC_BOB.testnet: confirm tBTC v2 contract on BOB testnet (chain 808)
//     against https://github.com/thesis/tbtc-v2 deployment registry
//   - TBTC_BOB.mainnet: confirm against same registry for BOB mainnet (chain 60808)
// ---------------------------------------------------------------------------

/**
 * sBTC SIP-010 token contract on Stacks.
 * Format: "{deployer}.{contract-name}"
 * Used by the Stacks balance fetcher to query sBTC holdings via
 * GET /extended/v1/address/{addr}/balances (Hiro API).
 */
export const SBTC = {
  /** sBTC v2 mainnet — deployed by Stacks Foundation. */
  mainnet: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
  /** sBTC v2 testnet — deployed by Stacks Foundation. */
  testnet: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token",
} as const;

/**
 * tBTC v2 ERC-20 token contract on BOB.
 * Used by the BOB balance fetcher via eth_call → balanceOf(address).
 * tBTC uses 18 decimals (standard ERC-20).
 *
 * BOB uses tBTC as its canonical wrapped BTC representation, bridged via
 * the Threshold Network tBTC v2 protocol.
 */
export const TBTC_BOB = {
  /** tBTC v2 on BOB mainnet (chain id 60808). VERIFY: against tBTC v2 deployment registry */
  mainnet: "0xBBa2eF945D523C4e2608C9E1214C2Cc64D4fc2e2",
  /** tBTC v2 on BOB testnet (chain id 808). PLACEHOLDER: verify deployment address */
  testnet: "0x0000000000000000000000000000000000000000",
} as const;

/**
 * ERC-20 ABI fragment for balanceOf — the only selector needed for balance fetching.
 * Encoded as the first 4 bytes of keccak256("balanceOf(address)") = 0x70a08231.
 */
export const BALANCE_OF_SELECTOR = "0x70a08231" as const;
