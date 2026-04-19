// ---------------------------------------------------------------------------
// BOB balance fetcher — ETH (native) + tBTC (ERC-20)
//
// API: BOB JSON-RPC (public node, no auth required for low-volume use)
// Methods:
//   eth_getBalance(address, "latest")         — ETH native balance in wei
//   eth_call({ to: tbtcContract, data: balanceOf(address) }, "latest")
//                                             — tBTC token balance in wei
//
// ETH uses 18 decimals (wei). tBTC uses 18 decimals (ERC-20 convention).
//
// tBTC on BOB is bridged via Threshold Network tBTC v2. BOB uses tBTC as
// its canonical BTC representation. ETH is the native gas token (not BTC).
//
// ⚠️  VERIFY:
//   - BOB mainnet RPC URL: https://rpc.gobob.xyz  (chain 60808)
//   - BOB testnet RPC URL: https://testnet.rpc.gobob.xyz  (chain 808)
//   - tBTC contract addresses in contracts.ts
// ---------------------------------------------------------------------------

import type { LayerBalance } from "@peelbtc/types";
import { TBTC_BOB, BALANCE_OF_SELECTOR } from "./contracts.js";

/**
 * Encode an EVM address as a zero-padded 32-byte hex parameter for eth_call.
 * Strips the 0x prefix from the address and left-pads to 64 hex chars.
 */
function encodeAddressParam(address: string): string {
  return address.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
}

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
 * Fetch ETH (native) and tBTC (ERC-20) balances for a BOB address.
 *
 * Returns two LayerBalance entries:
 *   [0] ETH native balance in wei  (isBtc = false)
 *   [1] tBTC token balance in wei  (isBtc = true)
 *
 * @param address   EVM address (0x...)
 * @param rpcUrl    BOB JSON-RPC endpoint
 * @param testnet   Whether this is a testnet address
 * @returns         Array of two LayerBalance entries (ETH + tBTC)
 */
export async function fetchBobBalances(
  address: string,
  rpcUrl: string,
  testnet: boolean,
): Promise<LayerBalance[]> {
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

  const tbtcBase: LayerBalance = {
    layer: "bob",
    address,
    asset: "tBTC",
    kind: "token",
    balance: 0n,
    decimals: 18,
    isBtc: true,
    testnet,
  };

  const tbtcContract = testnet ? TBTC_BOB.testnet : TBTC_BOB.mainnet;

  // Fetch ETH and tBTC in parallel
  const [ethResult, tbtcResult] = await Promise.allSettled([
    jsonRpc(rpcUrl, "eth_getBalance", [address, "latest"]),
    jsonRpc(rpcUrl, "eth_call", [
      {
        to: tbtcContract,
        data: `${BALANCE_OF_SELECTOR}${encodeAddressParam(address)}`,
      },
      "latest",
    ]),
  ]);

  const ethEntry: LayerBalance =
    ethResult.status === "fulfilled"
      ? { ...ethBase, balance: BigInt(ethResult.value) }
      : { ...ethBase, error: ethResult.reason instanceof Error ? ethResult.reason.message : String(ethResult.reason) };

  const tbtcEntry: LayerBalance =
    tbtcResult.status === "fulfilled"
      ? { ...tbtcBase, balance: BigInt(tbtcResult.value) }
      : { ...tbtcBase, error: tbtcResult.reason instanceof Error ? tbtcResult.reason.message : String(tbtcResult.reason) };

  return [ethEntry, tbtcEntry];
}
