// ---------------------------------------------------------------------------
// Bitcoin native balance fetcher
//
// API: mempool.space REST API (public, no auth required)
// Endpoint: GET {baseUrl}/address/{address}
//
// Response shape (relevant fields):
//   chain_stats.funded_txo_sum   — total satoshis received in confirmed txs
//   chain_stats.spent_txo_sum    — total satoshis spent in confirmed txs
//   mempool_stats.funded_txo_sum — total satoshis received in unconfirmed txs
//   mempool_stats.spent_txo_sum  — total satoshis spent in unconfirmed txs
//
// Confirmed balance = chain_stats.funded - chain_stats.spent
// Total balance     = confirmed + (mempool.funded - mempool.spent)
//
// We return confirmed balance only — unconfirmed UTXOs are not spendable.
//
// ⚠️  VERIFY: mempool.space API base URLs
//   mainnet: https://mempool.space/api
//   testnet: https://mempool.space/testnet/api
// ---------------------------------------------------------------------------

import type { LayerBalance } from "@peelbtc/types";

interface MempoolAddressResponse {
  chain_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
  mempool_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
}

/**
 * Fetch the confirmed BTC balance for a Bitcoin P2WPKH address.
 *
 * @param address   Bitcoin address (bc1q... or tb1q...)
 * @param baseUrl   mempool.space API base URL (e.g. "https://mempool.space/api")
 * @param testnet   Whether this is a testnet address
 * @returns         LayerBalance with confirmed satoshi balance
 */
export async function fetchBitcoinBalance(
  address: string,
  baseUrl: string,
  testnet: boolean,
): Promise<LayerBalance> {
  const base: LayerBalance = {
    layer: "bitcoin",
    address,
    asset: "BTC",
    kind: "native",
    balance: 0n,
    decimals: 8,
    isBtc: true,
    testnet,
  };

  try {
    const res = await fetch(`${baseUrl}/address/${address}`);
    if (!res.ok) {
      return { ...base, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const data = (await res.json()) as MempoolAddressResponse;
    const confirmed =
      data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;

    return { ...base, balance: BigInt(confirmed) };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
