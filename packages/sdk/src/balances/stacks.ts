// ---------------------------------------------------------------------------
// Stacks balance fetcher — STX (native) + sBTC (SIP-010 token)
//
// API: Hiro Platform API (public, no auth required for low-volume use)
// Endpoint: GET {baseUrl}/extended/v1/address/{address}/balances
//
// Response shape (relevant fields):
//   stx.balance                          — microSTX balance (string, decimal)
//   fungible_tokens["{contract}::token"] — SIP-010 token balances
//     .balance                           — token balance (string, decimal)
//
// STX uses 6 decimals (microSTX). sBTC uses 8 decimals (satoshi-equivalent).
//
// ⚠️  VERIFY:
//   - Hiro API base URL for testnet: https://api.testnet.hiro.so
//   - sBTC fungible token key format in Hiro response (may be
//     "{contractAddress}.{contractName}::sbtc-token" or similar)
//   - sBTC testnet contract address in contracts.ts
// ---------------------------------------------------------------------------

import type { LayerBalance } from "@peelbtc/types";
import { SBTC } from "./contracts.js";

interface HiroBalancesResponse {
  stx: {
    balance: string;
  };
  fungible_tokens: Record<string, { balance: string }>;
}

/**
 * Fetch STX and sBTC balances for a Stacks address.
 *
 * Returns two LayerBalance entries:
 *   [0] STX native balance (isBtc = false)
 *   [1] sBTC token balance (isBtc = true)
 *
 * @param address   Stacks c32check address (SP... or ST...)
 * @param baseUrl   Hiro API base URL (e.g. "https://api.hiro.so")
 * @param testnet   Whether this is a testnet address
 * @returns         Array of two LayerBalance entries (STX + sBTC)
 */
export async function fetchStacksBalances(
  address: string,
  baseUrl: string,
  testnet: boolean,
): Promise<LayerBalance[]> {
  const stxBase: LayerBalance = {
    layer: "stacks",
    address,
    asset: "STX",
    kind: "native",
    balance: 0n,
    decimals: 6,
    isBtc: false,
    testnet,
  };

  const sbtcBase: LayerBalance = {
    layer: "stacks",
    address,
    asset: "sBTC",
    kind: "token",
    balance: 0n,
    decimals: 8,
    isBtc: true,
    testnet,
  };

  try {
    const res = await fetch(`${baseUrl}/extended/v1/address/${address}/balances`);
    if (!res.ok) {
      const err = `HTTP ${res.status}: ${res.statusText}`;
      return [
        { ...stxBase, error: err },
        { ...sbtcBase, error: err },
      ];
    }

    const data = (await res.json()) as HiroBalancesResponse;

    // STX native balance (microSTX)
    const stxBalance = BigInt(data.stx.balance);

    // sBTC SIP-010 token balance
    // Hiro API key format: "{contractAddress}.{contractName}::sbtc-token"
    // ⚠️  VERIFY: confirm exact key format in live Hiro API response
    const sbtcContract = testnet ? SBTC.testnet : SBTC.mainnet;
    const sbtcKey = `${sbtcContract}::sbtc-token`;
    const sbtcBalance = BigInt(data.fungible_tokens[sbtcKey]?.balance ?? "0");

    return [
      { ...stxBase, balance: stxBalance },
      { ...sbtcBase, balance: sbtcBalance },
    ];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      { ...stxBase, error: msg },
      { ...sbtcBase, error: msg },
    ];
  }
}
