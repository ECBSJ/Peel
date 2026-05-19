// ---------------------------------------------------------------------------
// BOB transaction builders, preparers, encoder, and broadcaster
//
// Lifecycle:
//   1. build*   — construct minimal tx intent (no gas/nonce yet)
//   2. prepare  — fetch nonce + gas estimates, produce a fully populated tx
//   3. encode   — serialize the populated tx + OWS signature into a signed
//                 hex blob ready for broadcast
//   4. broadcast — submit the signed blob and return the tx hash
//
// OWS signs the serialized unsigned tx bytes (hex) and returns { signature }
// where signature = hex(r || s || v). The encode step injects those into the
// RLP-serialized transaction using viem's serializeTransaction.
// ---------------------------------------------------------------------------

import {
  encodeFunctionData,
  erc20Abi,
  serializeTransaction,
  type Address,
  type Hex,
} from "viem";
import { bob, bobSepolia } from "viem/chains";
import { createEvmClient } from "../balances/evm-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal unsigned tx intent — no gas or nonce yet.
 * Produced by the build* functions and passed to prepareBobTx.
 */
export interface EvmTxRequest {
  /** Sender address */
  from: Address;
  /** Recipient (or token contract for token transfers) */
  to: Address;
  /** Native ETH value in wei — 0n for token transfers */
  value: bigint;
  /** ABI-encoded calldata — "0x" for plain ETH transfers */
  data: Hex;
  /** EIP-155 chain ID */
  chainId: number;
}

/**
 * Fully populated EIP-1559 tx ready for serialization and signing.
 * Produced by prepareBobTx after fetching live chain values.
 */
export interface EvmTxPrepared {
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
  chainId: number;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  type: "eip1559";
}

/**
 * OWS SignResult shape — what the Node binding returns from sign_transaction.
 */
export interface OwsSignResult {
  /** Hex-encoded 65-byte signature: r(32) || s(32) || v(1) */
  signature: string;
  recoveryId?: number;
}

// ---------------------------------------------------------------------------
// buildBobEthTransfer
// ---------------------------------------------------------------------------

/**
 * Build an unsigned ETH transfer intent on BOB.
 *
 * @param from      Sender address
 * @param to        Recipient address
 * @param value     Amount in wei
 * @param testnet   true → bobSepolia (808813), false → bob (60808)
 */
export function buildBobEthTransfer(
  from: Address,
  to: Address,
  value: bigint,
  testnet: boolean,
): EvmTxRequest {
  const chain = testnet ? bobSepolia : bob;
  return { from, to, value, data: "0x", chainId: chain.id };
}

// ---------------------------------------------------------------------------
// buildBobTokenTransfer
// ---------------------------------------------------------------------------

/**
 * Build an unsigned ERC-20 token transfer intent on BOB.
 *
 * `to` in the returned tx is the token contract. The actual recipient is
 * ABI-encoded in `data` as transfer(recipient, amount).
 *
 * @param from            Sender address
 * @param recipient       Token recipient address
 * @param tokenContract   ERC-20 contract address
 * @param amount          Amount in token's smallest unit
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
  return { from, to: tokenContract, value: 0n, data, chainId: chain.id };
}

// ---------------------------------------------------------------------------
// prepareBobTx
// ---------------------------------------------------------------------------

/**
 * Fetch live chain values (nonce, gas estimate, fee data) and return a fully
 * populated EIP-1559 transaction ready for serialization.
 *
 * Must be called immediately before signing — nonce and fee data go stale.
 *
 * @param tx       Minimal tx intent from build*
 * @param testnet  Selects BOB mainnet or bobSepolia RPC
 * @param rpcUrl   Optional RPC override
 */
export async function prepareBobTx(
  tx: EvmTxRequest,
  testnet: boolean,
  rpcUrl?: string,
): Promise<EvmTxPrepared> {
  const chain = testnet ? bobSepolia : bob;
  const client = createEvmClient(chain, rpcUrl);

  const [nonce, gasEstimate, feeData] = await Promise.all([
    client.getTransactionCount({ address: tx.from }),
    client.estimateGas({
      account: tx.from,
      to: tx.to,
      value: tx.value,
      data: tx.data,
    }),
    client.estimateFeesPerGas(),
  ]);

  return {
    from: tx.from,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    chainId: tx.chainId,
    nonce,
    gas: gasEstimate,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    type: "eip1559",
  };
}

// ---------------------------------------------------------------------------
// serializeBobTx
// ---------------------------------------------------------------------------

/**
 * Serialize a prepared (but unsigned) tx to a hex string for OWS to sign.
 *
 * Pass the returned hex to OWS sign_transaction:
 *   ows.signTransaction(walletId, "evm", serialized, passphrase)
 */
export function serializeBobTx(tx: EvmTxPrepared): Hex {
  // serializeTransaction without a signature produces the unsigned envelope
  const { from: _from, ...txFields } = tx;
  return serializeTransaction(txFields);
}

// ---------------------------------------------------------------------------
// encodeBobSignedTx
// ---------------------------------------------------------------------------

/**
 * Attach an OWS signature to a prepared tx and produce the broadcast-ready
 * signed transaction hex.
 *
 * OWS returns signature as hex(r[32] || s[32] || v[1]).
 * viem's serializeTransaction accepts { r, s, v } to produce the final blob.
 *
 * @param tx     The same prepared tx that was serialized for signing
 * @param sig    SignResult from OWS sign_transaction
 */
export function encodeBobSignedTx(tx: EvmTxPrepared, sig: OwsSignResult): Hex {
  const sigBytes = sig.signature.replace(/^0x/, "");
  if (sigBytes.length !== 130) {
    throw new Error(
      `expected 65-byte signature (130 hex chars), got ${sigBytes.length / 2} bytes`,
    );
  }

  const r = `0x${sigBytes.slice(0, 64)}` as Hex;
  const s = `0x${sigBytes.slice(64, 128)}` as Hex;
  const v = BigInt(`0x${sigBytes.slice(128, 130)}`);

  const { from: _from, ...txFields } = tx;
  return serializeTransaction(txFields, { r, s, v });
}

// ---------------------------------------------------------------------------
// broadcastBobTx
// ---------------------------------------------------------------------------

/**
 * Broadcast a signed transaction to BOB and return the tx hash.
 *
 * @param signedTxHex  Output of encodeBobSignedTx
 * @param testnet      Selects BOB mainnet or bobSepolia
 * @param rpcUrl       Optional RPC override
 */
export async function broadcastBobTx(
  signedTxHex: Hex,
  testnet: boolean,
  rpcUrl?: string,
): Promise<Hex> {
  const chain = testnet ? bobSepolia : bob;
  const client = createEvmClient(chain, rpcUrl);
  return client.sendRawTransaction({ serializedTransaction: signedTxHex });
}
