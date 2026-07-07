// ---------------------------------------------------------------------------
// Citrea balance fetcher — cBTC (native)
//
// API: Citrea public node JSON-RPC (no auth required for low-volume use)
// Method: eth_getBalance(address, "latest") — cBTC balance in wei
//
// cBTC is the native gas asset on Citrea. BTC is locked on Bitcoin L1 via
// the Clementine bridge (ZK-proven BitVM2 design) and minted 1:1 as cBTC
// on Citrea. No contract address — cBTC is the native coin of the Citrea EVM.
//
// cBTC uses 18 decimals (EVM native asset convention).
// Conversion to satoshis: wei / 10^10
//
// ⚠️  VERIFY:
//   - Citrea mainnet RPC URL: https://rpc.mainnet.citrea.xyz  (chain 4114)
//   - Citrea testnet RPC URL: https://rpc.testnet.citrea.xyz  (chain 5115)
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
 * Fetch the cBTC native balance for a Citrea address.
 *
 * @param address   EVM address (0x...)
 * @param rpcUrl    Citrea JSON-RPC endpoint
 * @param testnet   Whether this is a testnet address
 * @returns         LayerBalance with cBTC balance in wei
 */
export async function fetchCitreaBalance(
  address: string,
  rpcUrl: string,
  testnet: boolean,
): Promise<LayerBalance> {
  const base: LayerBalance = {
    layer: "citrea",
    address,
    asset: "cBTC",
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
