// ---------------------------------------------------------------------------
// Rootstock transaction builders, preparers, encoder, and broadcaster
//
// Lifecycle:
//   1. build   — construct minimal tx intent (no gas/nonce yet)
//   2. prepare — fetch nonce + gas estimates, produce a fully populated tx
//   3. encode  — serialize the populated tx + OWS signature into a signed
//                hex blob ready for broadcast
//   4. broadcast — submit the signed blob and return the tx hash
//
// OWS signs the serialized unsigned tx bytes (hex) and returns { signature }
// where signature = hex(r || s || v). The encode step injects those into the
// RLP-serialized transaction using viem's serializeTransaction.
// ---------------------------------------------------------------------------

import { serializeTransaction, type Address, type Hex } from "viem";
import { rootstock, rootstockTestnet } from "viem/chains";
import { createEvmClient } from "../balances/evm-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RootstockTxRequest {
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
  chainId: number;
}

export interface RootstockTxPrepared {
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
  chainId: number;
  nonce: number;
  gas: bigint;
  gasPrice: bigint;
  type: "legacy";
}

export interface OwsSignResult {
  signature: string;
  recoveryId?: number;
}

// ---------------------------------------------------------------------------
// buildRootstockTransfer
// ---------------------------------------------------------------------------

/**
 * Build an unsigned RBTC transfer intent on Rootstock.
 *
 * @param from      Sender address
 * @param to        Recipient address
 * @param value     Amount in wei
 * @param testnet   true -> rootstockTestnet (31), false -> rootstock (30)
 */
export function buildRootstockTransfer(
  from: Address,
  to: Address,
  value: bigint,
  testnet: boolean,
): RootstockTxRequest {
  const chain = testnet ? rootstockTestnet : rootstock;
  return { from, to, value, data: "0x", chainId: chain.id };
}

// ---------------------------------------------------------------------------
// prepareRootstockTx
// ---------------------------------------------------------------------------

/**
 * Fetch live chain values (nonce, gas estimate, gas price) and return a fully
 * populated legacy transaction ready for serialization.
 */
export async function prepareRootstockTx(
  tx: RootstockTxRequest,
  testnet: boolean,
  rpcUrl?: string,
): Promise<RootstockTxPrepared> {
  const chain = testnet ? rootstockTestnet : rootstock;
  const client = createEvmClient(chain, rpcUrl);

  const [nonce, gasEstimate, feeData] = await Promise.all([
    client.getTransactionCount({ address: tx.from }),
    client.estimateGas({
      account: tx.from,
      to: tx.to,
      value: tx.value,
      data: tx.data,
    }),
    client.getGasPrice(),
  ]);

  return {
    from: tx.from,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    chainId: tx.chainId,
    nonce,
    gas: gasEstimate,
    gasPrice: feeData,
    type: "legacy",
  };
}

// ---------------------------------------------------------------------------
// serializeRootstockTx
// ---------------------------------------------------------------------------

export function serializeRootstockTx(tx: RootstockTxPrepared): Hex {
  const { from: _from, ...txFields } = tx;
  return serializeTransaction(txFields);
}

// ---------------------------------------------------------------------------
// encodeRootstockSignedTx
// ---------------------------------------------------------------------------

export function encodeRootstockSignedTx(
  tx: RootstockTxPrepared,
  sig: OwsSignResult,
): Hex {
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
// broadcastRootstockTx
// ---------------------------------------------------------------------------

export async function broadcastRootstockTx(
  signedTxHex: Hex,
  testnet: boolean,
  rpcUrl?: string,
): Promise<Hex> {
  const chain = testnet ? rootstockTestnet : rootstock;
  const client = createEvmClient(chain, rpcUrl);
  return client.sendRawTransaction({ serializedTransaction: signedTxHex });
}
