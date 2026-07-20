// ---------------------------------------------------------------------------
// Address → layer resolution
//
// Determines which chain(s) a destination address can belong to.
// This is the first filter in the routing pipeline — it eliminates impossible
// routes before any scoring or fee fetching happens.
// ---------------------------------------------------------------------------

import type { NetworkLayer } from "./types.js";

export type ResolvedDestination =
  | { layer: "bitcoin";   address: string }
  | { layer: "stacks";    address: string }
  | { layer: "evm";       address: string; possibleChains: Array<"bob" | "rootstock" | "citrea"> };

/**
 * Detect which layer(s) a destination address belongs to.
 *
 * - Bitcoin:  bc1q..., bc1p..., 1..., 3..., tb1..., m..., n..., 2...
 * - Stacks:   SP... (mainnet), ST... (testnet)
 * - EVM:      0x followed by 40 hex chars (BOB / Rootstock / Citrea)
 *
 * Throws if the address format is not recognised.
 */
export function resolveDestination(address: string): ResolvedDestination {
  const addr = address.trim();

  // Stacks — unambiguous
  if (/^S[PT][A-Z0-9]{38,}$/.test(addr)) {
    return { layer: "stacks", address: addr };
  }

  // Bitcoin — all formats
  if (isBitcoinAddress(addr)) {
    return { layer: "bitcoin", address: addr };
  }

  // EVM — all three L2s share the same address format
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return {
      layer: "evm",
      address: addr,
      // Citrea is included as a possible chain for direct transfers only.
      // Bridge routes to Citrea are excluded later in the pipeline.
      possibleChains: ["bob", "rootstock", "citrea"],
    };
  }

  throw new Error(
    `unrecognised address format: "${addr}". ` +
    "Expected a Bitcoin, Stacks (SP.../ST...), or EVM (0x...) address.",
  );
}

function isBitcoinAddress(addr: string): boolean {
  const lower = addr.toLowerCase();
  // bech32 / bech32m (native segwit + taproot, mainnet + testnet)
  if (lower.startsWith("bc1") || lower.startsWith("tb1")) return true;
  // P2PKH mainnet (1...), testnet (m... / n...)
  if (/^[1mn][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) return true;
  // P2SH mainnet (3...), testnet (2...)
  if (/^[23][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) return true;
  return false;
}

/**
 * Extract the sender's address on a given layer from a BridIdentityMap.derived array.
 * Returns undefined if the layer is not present.
 */
export function senderAddressFor(
  derived: Array<{ address: string; layer: string; testnet: boolean }>,
  layer: NetworkLayer,
  testnet = false,
): string | undefined {
  const mapLayer = layer === "bob" || layer === "rootstock" || layer === "citrea" ? "evm" : layer;
  return derived.find(d => d.layer === mapLayer && d.testnet === testnet)?.address;
}
