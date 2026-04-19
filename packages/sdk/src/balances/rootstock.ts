// ---------------------------------------------------------------------------
// Rootstock balance fetcher — RBTC (native)
//
// API: Rootstock public node JSON-RPC (no auth required for low-volume use)
// Method: eth_getBalance(address, "latest") — RBTC balance in wei
//
// RBTC is the native gas asset on Rootstock, pegged 1:1 to BTC via the
// RSK Federation two-way peg. No contract address — RBTC is transferred
// as native value in transactions, equivalent to ETH on Ethereum.
//
// RBTC uses 18 decimals (EVM native asset convention).
// Conversion to satoshis: wei / 10^10
//
// ⚠️  VERIFY:
//   - Rootstock mainnet RPC URL: https://public-node.rsk.co  (chain 30)
//   - Rootstock testnet RPC URL: https://public-node.testnet.rsk.co  (chain 31)
// ---------------------------------------------------------------------------

import type { LayerBalance } from "@peelbtc/types";

/**
 * Make a JSON-RPC call to an EVM node.
 */
async function jsonRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as { result?: string; error?: { message: string } };

  if (data.error) {
    throw new Error(data.error.message);
  }

  return data.result ?? "0x0";
}

/**
 * Fetch the RBTC native balance for a Rootstock address.
 *
 * @param address   EVM address (0x...)
 * @param rpcUrl    Rootstock JSON-RPC endpoint
 * @param testnet   Whether this is a testnet address
 * @returns         LayerBalance with RBTC balance in wei
 */
export async function fetchRootstockBalance(
  address: string,
  rpcUrl: string,
  testnet: boolean,
): Promise<LayerBalance> {
  const base: LayerBalance = {
    layer: "rootstock",
    address,
    asset: "RBTC",
    kind: "native",
    balance: 0n,
    decimals: 18,
    isBtc: true,
    testnet,
  };

  try {
    const result = await jsonRpc(rpcUrl, "eth_getBalance", [address, "latest"]);
    return { ...base, balance: BigInt(result) };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
