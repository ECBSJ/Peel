// ---------------------------------------------------------------------------
// BOB balance fetcher
//
// Fetches:
//   - ETH native balance (gas token, isBtc = false)
//   - One or more wrapped BTC token balances (ERC-20, isBtc = true)
//
// BOB does not have a single canonical wrapped BTC — it supports multiple
// (wBTC, tBTC, SolvBTC, etc). The `wrappedBtcTokens` parameter accepts
// an array of token configs, so callers decide which tokens to query.
// A sensible default is provided for common use.
//
// Chain: viem exports `bob` (mainnet, chain 60808) and `bobSepolia`
// (testnet, chain 808813) with built-in RPC URLs — no hardcoding needed.
// ---------------------------------------------------------------------------

import { erc20Abi, type Address } from "viem";
import { bob, bobSepolia } from "viem/chains";
import type { LayerBalance } from "@peelbtc/types";
import { createEvmClient } from "./evm-client.js";

// ---------------------------------------------------------------------------
// Wrapped BTC token registry for BOB
//
// BOB supports multiple wrapped BTC assets. Each entry here will produce
// one LayerBalance entry with isBtc = true.
// ---------------------------------------------------------------------------

export interface BobWrappedBtcToken {
  /** Asset symbol shown in LayerBalance */
  asset: string;
  /** ERC-20 contract address on BOB mainnet */
  mainnet: Address;
  /** ERC-20 contract address on BOB testnet (bobSepolia) */
  testnet: Address;
  /** Number of decimals — wBTC uses 8, tBTC uses 18 */
  decimals: number;
}

/**
 * Default wrapped BTC tokens tracked on BOB.
 * Pass a custom array to `fetchBobBalances` to override.
 *
 */
export const BOB_WRAPPED_BTC_TOKENS: BobWrappedBtcToken[] = [
  {
    asset: "wBTC",
    mainnet: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    // ⚠️  VERIFY: wBTC on BOB testnet (bobSepolia)
    testnet: "0x0000000000000000000000000000000000000000",
    decimals: 8,
  },
];

// ---------------------------------------------------------------------------
// fetchBobBalances
// ---------------------------------------------------------------------------

/**
 * Fetch ETH and wrapped BTC token balances for a BOB address.
 *
 * Returns one LayerBalance for ETH (isBtc = false) followed by one entry
 * per token in `wrappedBtcTokens` (isBtc = true).
 *
 * @param address           EVM address (0x...)
 * @param testnet           true → bobSepolia, false → bob mainnet
 * @param wrappedBtcTokens  Tokens to query. Defaults to BOB_WRAPPED_BTC_TOKENS.
 * @param rpcUrl            Optional RPC URL override (defaults to viem built-in).
 */
export async function fetchBobBalances(
  address: Address,
  testnet: boolean,
  wrappedBtcTokens: BobWrappedBtcToken[] = BOB_WRAPPED_BTC_TOKENS,
  rpcUrl?: string,
): Promise<LayerBalance[]> {
  const chain = testnet ? bobSepolia : bob;
  const client = createEvmClient(chain, rpcUrl);

  const ethBase: LayerBalance = {
    layer: "bob",
    address,
    asset: "ETH",
    kind: "native",
    balance: 0n,
    decimals: 18,
    isBtc: false,
    testnet,
  };

  // Build token base entries
  const tokenBases: LayerBalance[] = wrappedBtcTokens.map((token) => ({
    layer: "bob",
    address,
    asset: token.asset,
    kind: "token" as const,
    balance: 0n,
    decimals: token.decimals,
    isBtc: true,
    testnet,
  }));

  // Fetch ETH native balance + all token balances in parallel
  const [ethResult, ...tokenResults] = await Promise.allSettled([
    client.getBalance({ address }),
    ...wrappedBtcTokens.map((token) =>
      client.readContract({
        address: testnet ? token.testnet : token.mainnet,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ),
  ]);

  const ethEntry: LayerBalance =
    ethResult.status === "fulfilled"
      ? { ...ethBase, balance: ethResult.value }
      : { ...ethBase, error: ethResult.reason instanceof Error ? ethResult.reason.message : String(ethResult.reason) };

  const tokenEntries: LayerBalance[] = tokenResults.map((result, i) =>
    result.status === "fulfilled"
      ? { ...tokenBases[i], balance: result.value as bigint }
      : { ...tokenBases[i], error: result.reason instanceof Error ? result.reason.message : String(result.reason) },
  );

  return [ethEntry, ...tokenEntries];
}