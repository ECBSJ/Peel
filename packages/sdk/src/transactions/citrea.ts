// ---------------------------------------------------------------------------
// Citrea transaction builders, preparers, encoder, and broadcaster
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
import { citrea, citreaTestnet } from "viem/chains";
import { createEvmClient } from "../balances/evm-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CitreaTxRequest {
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
  chainId: number;
}

export interface CitreaTxPrepared {
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

export interface OwsSignResult {
  signature: string;
  recoveryId?: number;
}

// ---------------------------------------------------------------------------
// buildCitreaTransfer
// ---------------------------------------------------------------------------

/**
 * Build an unsigned cBTC transfer intent on Citrea.
 *
 * @param from      Sender address
 * @param to        Recipient address
 * @param value     Amount in wei
 * @param testnet   true -> citreaTestnet (5115), false -> citrea (4114)
 */
export function buildCitreaTransfer(
  from: Address,
  to: Address,
  value: bigint,
  testnet: boolean,
): CitreaTxRequest {
  const chain = testnet ? citreaTestnet : citrea;
  return { from, to, value, data: "0x", chainId: chain.id };
}

// ---------------------------------------------------------------------------
// prepareCitreaTx
// ---------------------------------------------------------------------------

/**
 * Fetch live chain values (nonce, gas estimate, fee data) and return a fully
 * populated EIP-1559 transaction ready for serialization.
 */
export async function prepareCitreaTx(
  tx: CitreaTxRequest,
  testnet: boolean,
  rpcUrl?: string,
): Promise<CitreaTxPrepared> {
  const chain = testnet ? citreaTestnet : citrea;
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
// serializeCitreaTx
// ---------------------------------------------------------------------------

export function serializeCitreaTx(tx: CitreaTxPrepared): Hex {
  const { from: _from, ...txFields } = tx;
  return serializeTransaction(txFields);
}

// ---------------------------------------------------------------------------
// encodeCitreaSignedTx
// ---------------------------------------------------------------------------

export function encodeCitreaSignedTx(tx: CitreaTxPrepared, sig: OwsSignResult): Hex {
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
// broadcastCitreaTx
// ---------------------------------------------------------------------------

export async function broadcastCitreaTx(
  signedTxHex: Hex,
  testnet: boolean,
  rpcUrl?: string,
): Promise<Hex> {
  const chain = testnet ? citreaTestnet : citrea;
  const client = createEvmClient(chain, rpcUrl);
  return client.sendRawTransaction({ serializedTransaction: signedTxHex });
}
