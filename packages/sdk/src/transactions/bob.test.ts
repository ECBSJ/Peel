// ---------------------------------------------------------------------------
// bob transaction builder tests
//
// Pure unit tests — no mocking needed since the builders make no network
// calls. Just construction logic and output shape verification.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildBobEthTransfer, buildBobTokenTransfer } from "../transactions/bob.js";
import { bob, bobSepolia } from "viem/chains";
import { decodeFunctionData, erc20Abi } from "viem";
import type { Address } from "viem";

const FROM: Address = "0x1111111111111111111111111111111111111111";
const TO: Address = "0x2222222222222222222222222222222222222222";
const WBTC_CONTRACT: Address = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

// ---------------------------------------------------------------------------
// buildBobEthTransfer
// ---------------------------------------------------------------------------

describe("buildBobEthTransfer", () => {
  it("sets correct from, to, value", () => {
    const tx = buildBobEthTransfer(FROM, TO, 1_000_000_000_000_000n, false);

    expect(tx.from).toBe(FROM);
    expect(tx.to).toBe(TO);
    expect(tx.value).toBe(1_000_000_000_000_000n);
  });

  it("data is 0x for a plain ETH transfer", () => {
    const tx = buildBobEthTransfer(FROM, TO, 1n, false);
    expect(tx.data).toBe("0x");
  });

  it("uses BOB mainnet chainId (60808) when testnet=false", () => {
    const tx = buildBobEthTransfer(FROM, TO, 1n, false);
    expect(tx.chainId).toBe(bob.id);
    expect(tx.chainId).toBe(60808);
  });

  it("uses bobSepolia chainId (808813) when testnet=true", () => {
    const tx = buildBobEthTransfer(FROM, TO, 1n, true);
    expect(tx.chainId).toBe(bobSepolia.id);
    expect(tx.chainId).toBe(808813);
  });

  it("value=0n is valid (zero-value transfer)", () => {
    const tx = buildBobEthTransfer(FROM, TO, 0n, false);
    expect(tx.value).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// buildBobTokenTransfer
// ---------------------------------------------------------------------------

describe("buildBobTokenTransfer", () => {
  it("to field is the token contract, not the recipient", () => {
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, 5_000_000n, false);
    expect(tx.to).toBe(WBTC_CONTRACT);
    expect(tx.to).not.toBe(TO);
  });

  it("value is 0n — no ETH sent with a token transfer", () => {
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, 5_000_000n, false);
    expect(tx.value).toBe(0n);
  });

  it("calldata decodes to transfer(recipient, amount)", () => {
    const amount = 5_000_000n;
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, amount, false);

    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });

    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args[0]).toBe(TO);
    expect(decoded.args[1]).toBe(amount);
  });

  it("uses BOB mainnet chainId when testnet=false", () => {
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, 1n, false);
    expect(tx.chainId).toBe(bob.id);
  });

  it("uses bobSepolia chainId when testnet=true", () => {
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, 1n, true);
    expect(tx.chainId).toBe(bobSepolia.id);
  });

  it("from address is preserved in the tx", () => {
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, 1n, false);
    expect(tx.from).toBe(FROM);
  });

  it("works with large amounts (no bigint overflow)", () => {
    // 21 million BTC in satoshis
    const maxSats = 2_100_000_000_000_000n;
    const tx = buildBobTokenTransfer(FROM, TO, WBTC_CONTRACT, maxSats, false);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    expect(decoded.args[1]).toBe(maxSats);
  });
});
