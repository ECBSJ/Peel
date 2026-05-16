// ---------------------------------------------------------------------------
// BOB transaction builders
//
// Produces unsigned EVM transaction objects ready to be signed and broadcast.
// No signing or network calls happen here — these are pure construction
// functions. Gas estimation and nonce are added at signing time.
//
// Two transfer types:
//   buildBobEthTransfer   — send native ETH
//   buildBobTokenTransfer — send any ERC-20 token (wBTC, tBTC, etc.)
//
// The returned EvmTxRequest includes chainId so the signer can validate it
// is signing for the right network before submitting.
// ---------------------------------------------------------------------------

import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { bob, bobSepolia } from "viem/chains";

// ---------------------------------------------------------------------------
// EvmTxRequest — unsigned EVM transaction
//
// Fields deliberately minimal — only what the signer needs.
// Gas, nonce, and maxFeePerGas are intentionally omitted; they should be
// estimated fresh at signing time to avoid stale values.
// ---------------------------------------------------------------------------

export interface EvmTxRequest {
  /** Sender address */
  from: Address;
  /** Recipient address (for token transfers, this is the contract address) */
  to: Address;
  /** Native value in wei — 0n for token transfers */
  value: bigint;
  /** ABI-encoded calldata — "0x" for plain ETH transfers */
  data: Hex;
  /** EIP-155 chain ID — prevents replay across networks */
  chainId: number;
}

// ---------------------------------------------------------------------------
// buildBobEthTransfer
// ---------------------------------------------------------------------------

/**
 * Build an unsigned ETH transfer on BOB.
 *
 * @param from      Sender address
 * @param to        Recipient address
 * @param value     Amount in wei
 * @param testnet   true → bobSepolia (chain 808813), false → bob (chain 60808)
 */
export function buildBobEthTransfer(
  from: Address,
  to: Address,
  value: bigint,
  testnet: boolean,
): EvmTxRequest {
  const chain = testnet ? bobSepolia : bob;
  return {
    from,
    to,
    value,
    data: "0x",
    chainId: chain.id,
  };
}

// ---------------------------------------------------------------------------
// buildBobTokenTransfer
// ---------------------------------------------------------------------------

/**
 * Build an unsigned ERC-20 token transfer on BOB.
 *
 * The `to` field of the returned tx is the token contract address.
 * The actual recipient is encoded in the calldata via `transfer(recipient, amount)`.
 *
 * @param from            Sender address
 * @param recipient       Token recipient address
 * @param tokenContract   ERC-20 contract address for the token
 * @param amount          Amount in the token's smallest unit (e.g. satoshis for wBTC)
 * @param testnet         true → bobSepolia, false → bob mainnet
 */
export function buildBobTokenTransfer(
  from: Address,
  recipient: Address,
  tokenContract: Address,
  amount: bigint,
  testnet: boolean,
): EvmTxRequest {
  const chain = testnet ? bobSepolia : bob;
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amount],
  });

  return {
    from,
    to: tokenContract,
    value: 0n,
    data,
    chainId: chain.id,
  };
}
