// ---------------------------------------------------------------------------
// EVM public client factory — shared across all EVM chain fetchers
//
// Creates a viem PublicClient for a given chain. Each EVM layer (BOB,
// Rootstock, Citrea) calls this with its own chain definition. Using
// viem's built-in chain objects means RPC URLs are managed by viem —
// no hardcoded URLs needed in the fetchers themselves.
//
// Rootstock and Citrea fetchers import createEvmClient from here, passing
// their respective viem chain objects, keeping all viem setup in one place.
// ---------------------------------------------------------------------------

import { createPublicClient, http, type Chain, type PublicClient } from "viem";

/**
 * Create a viem PublicClient for the given EVM chain.
 *
 * Uses viem's built-in RPC URL for the chain by default (via `http()`
 * with no explicit URL). Pass a custom `rpcUrl` to override — useful
 * for production deployments or tests that need to intercept transport.
 *
 * @param chain    viem Chain object (e.g. bob, rootstock, citrea)
 * @param rpcUrl   Optional RPC URL override. Defaults to viem's built-in.
 */
export function createEvmClient(chain: Chain, rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}
