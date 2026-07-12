import { Flyover, FlyoverUtils } from "@rsksmart/flyover-sdk";
import type {
  AcceptedPegoutQuote,
  PegoutQuote,
  PegoutQuoteStatus,
  Quote,
} from "@rsksmart/flyover-sdk";
import type {
  BridgeAdapter,
  BridgeDepositResult,
  BridgeStatus,
  BridgeStatusResult,
} from "@peelbtc/types";

/**
 * Everything an agent needs to construct and broadcast the BTC payment for a
 * Flyover peg-in. Preserve `quote` and `lpSignature` — they are required if
 * the agent later needs to call `registerPegin` as a recovery step.
 */
export interface PegInPaymentPlan {
  /** BTC address the agent must send to (Flyover LP derivation address). */
  depositAddress: string;
  /** Exact satoshi amount to send. Includes LP fees. */
  amountSats: bigint;
  /**
   * Unix timestamp deadline. The BTC deposit must receive at least one
   * confirmation before this time, or the quote expires.
   */
  deadlineUnix: number;
  /** Quote identifier. Pass to `pollStatus()` or `getRegisterPegInInfo()`. */
  quoteHash: string;
  /**
   * LP commitment signature returned by `acceptQuote`. Preserve this — it is
   * a required argument to the LBC `registerPegin()` function if the user
   * needs to trigger registration manually (recovery path).
   */
  lpSignature: string;
  /**
   * Hash of the BTC deposit address returned by `acceptQuote`. Preserve this
   * alongside `lpSignature` — required for `validatePegInTransaction()`.
   */
  bitcoinDepositAddressHash: string;
  /**
   * Full quote object returned by the LP. Preserve this — it is a required
   * argument to `getRegisterPegInInfo()` and to `flyover.registerPegin()`.
   */
  quote: Quote;
  /** LBC contract address on Rootstock (informational). */
  lbcAddress: string;
  /** Number of BTC confirmations the LP requires before acting. */
  requiredBtcConfirmations: number;
  /** Wei-denominated fee breakdown (informational). */
  fees: {
    /** Net amount being bridged (wei). */
    valueWei: bigint;
    /** LP service fee (wei). */
    callFeeWei: bigint;
    /** Gas fee (wei). */
    gasFeeWei: bigint;
    /** Penalty the LP pays if they fail to deliver (wei). */
    penaltyFeeWei: bigint;
    /** Total: valueWei + callFeeWei + gasFeeWei (wei). */
    totalWei: bigint;
  };
}

/**
 * Parameters the agent needs to trigger `registerPegin` on the LBC contract
 * as a recovery step if the LP does not register the peg-in automatically.
 *
 * The LBC `registerPegin(quote, signature, btcRawTransaction,
 * partialMerkleTree, height)` function also requires Bitcoin SPV proof that
 * must be fetched from a Bitcoin node using `userBtcTxHash`:
 *  - `btcRawTransaction`: raw serialized tx bytes (no SegWit witness data)
 *  - `partialMerkleTree`: PMT proof bytes for the tx in its block
 *  - `height`: block height containing the tx
 *
 * The easiest way for an agent to assemble all of this is to call
 * `adapter.connectToBitcoin(new Mempool({ network }))` and then
 * `flyover.registerPegin({ quote, providerSignature, userBtcTransactionHash })`
 * via the `RootstockFlyoverBridgeAdapter.registerPegin()` wrapper, which
 * delegates to the SDK and handles SPV fetching automatically.
 */
export interface RegisterPegInInfo {
  /** LBC contract address on Rootstock — the RSK tx recipient. */
  lbcAddress: string;
  /** Value to send with the RSK tx. Always 0 — registerPegin is nonpayable. */
  valueRbtc: bigint;
  /** Quote to pass as the first argument to `registerPegin()`. */
  quote: Quote;
  /** LP signature to pass as the second argument to `registerPegin()`. */
  lpSignature: string;
  /** BTC txid of the user's payment. Used to look up the BTC SPV proof. */
  userBtcTxHash: string;
}

const SATS_TO_WEI_FACTOR = 10_000_000_000n;

function satsToWei(sats: bigint): bigint {
  return sats * SATS_TO_WEI_FACTOR;
}

function weiToSats(wei: bigint): bigint {
  return wei / SATS_TO_WEI_FACTOR;
}

/** LBC contract addresses by network (v2.0.1). */
export const FLYOVER_LBC_ADDRESS = {
  mainnet: "0xaa9caf1e3967600578727f975f283446a3da6612" as `0x${string}`,
  testnet: "0xc2a630c053d12d63d32b025082f6ba268db18300" as `0x${string}`,
} as const;

/**
 * Flyover protocol transfer limits.
 * Minimums are enforced by the protocol. Maximums are LP-set and will increase over time.
 * Current default LP cap: 15 BTC / 15 rBTC.
 */
export const FLYOVER_LIMITS = {
  /** Minimum peg-in: 0.00500001 BTC (satoshis). */
  minPegInSats: 500_001n,
  /** Minimum peg-out: 0.004 rBTC (wei). */
  minPegOutWei: 4_000_000_000_000_000n,
  /** Maximum peg-in: 15 BTC (satoshis). LP-set. */
  maxPegInSats: 1_500_000_000n,
  /** Maximum peg-out: 15 rBTC (wei). LP-set. */
  maxPegOutWei: 15_000_000_000_000_000_000n,
} as const;

export interface RootstockFlyoverAdapterOptions {
  testnet?: boolean;
  providerIndex?: number;
  minDepositSats?: bigint;
  captchaTokenResolver?: () => Promise<string>;
  /**
   * Disable RSK address checksum validation. Set to `true` when using
   * standard EIP-55 checksummed addresses instead of RSK-checksummed ones.
   */
  disableChecksum?: boolean;
}

export interface RootstockPegoutQuoteResult {
  quote: PegoutQuote;
  acceptedQuote: AcceptedPegoutQuote;
  quoteHash: string;
  totalAmountWei: bigint;
  totalAmountSats: bigint;
  lbcAddress: string;
  signature: string;
}

export class RootstockFlyoverBridgeAdapter implements BridgeAdapter {
  readonly id = "rbtc";
  readonly name = "Rootstock Flyover";
  readonly targetNetwork: string;
  readonly mintedAsset: string;
  readonly minDepositSats: bigint;

  private readonly flyover: Flyover;
  private readonly providerIndex: number;

  constructor(options: RootstockFlyoverAdapterOptions = {}) {
    const testnet = options.testnet ?? false;
    this.targetNetwork = testnet ? "rootstock-testnet" : "rootstock";
    this.mintedAsset = testnet ? "tRBTC" : "RBTC";
    this.minDepositSats = options.minDepositSats ?? FLYOVER_LIMITS.minPegInSats;
    this.providerIndex = options.providerIndex ?? 0;

    this.flyover = new Flyover({
      network: testnet ? "Testnet" : "Mainnet",
      captchaTokenResolver:
        options.captchaTokenResolver ?? (async () => Promise.resolve("")),
      disableChecksum: options.disableChecksum,
    });
  }

  estimateMintTime(): number {
    // Flyover settles in 20–60 min depending on amount/confirmations required.
    // 40 min is a reasonable middle estimate.
    return 40 * 60;
  }

  async connectToRsk(
    connection: Parameters<Flyover["connectToRsk"]>[0],
  ): Promise<void> {
    await this.flyover.connectToRsk(connection);
  }

  connectToBitcoin(
    bitcoinDataSource: Parameters<Flyover["connectToBitcoin"]>[0],
  ): void {
    this.flyover.connectToBitcoin(bitcoinDataSource);
  }

  /**
   * Get a full peg-in payment plan: fetch a quote from the LP, accept it, and
   * return everything the agent needs to construct and broadcast the BTC
   * payment. Preserve the returned `quote` and `lpSignature` — they are needed
   * if `registerPegin` must be called manually as a recovery step.
   *
   * After broadcasting the BTC payment, poll status with `pollStatus(quoteHash)`.
   * If the LP does not register the peg-in automatically, call `registerPegin()`
   * using the info returned by `getRegisterPegInInfo()`.
   */
  async getPegInPaymentPlan(
    amountSats: bigint,
    recipientRskAddress: string,
  ): Promise<PegInPaymentPlan> {
    if (amountSats <= 0n) {
      throw new Error("amountSats must be greater than 0");
    }

    await this.ensureLiquidityProvider();

    const quoteRequest = {
      callContractArguments: "0x",
      callEoaOrContractAddress: recipientRskAddress,
      rskRefundAddress: recipientRskAddress,
      valueToTransfer: satsToWei(amountSats),
    };

    const quotes = await this.flyover.getQuotes(quoteRequest);
    const quote = quotes.at(0);
    if (!quote) {
      throw new Error("no peg-in quotes returned by Flyover liquidity providers");
    }

    const accepted = await this.flyover.acceptQuote(quote);

    const status = await this.flyover.getPeginStatus(quote.quoteHash);
    const depositAddress = status.status.depositAddress;
    if (!depositAddress) {
      throw new Error("Flyover did not return a BTC deposit address after accepting quote");
    }

    const totalWei = FlyoverUtils.getQuoteTotal(quote);

    return {
      depositAddress,
      amountSats: weiToSats(totalWei),
      deadlineUnix: quote.quote.agreementTimestamp + quote.quote.timeForDeposit,
      quoteHash: quote.quoteHash,
      lpSignature: accepted.signature,
      bitcoinDepositAddressHash: accepted.bitcoinDepositAddressHash,
      quote,
      lbcAddress: quote.quote.lbcAddr,
      requiredBtcConfirmations: quote.quote.confirmations,
      fees: {
        valueWei: quote.quote.value,
        callFeeWei: quote.quote.callFee,
        gasFeeWei: quote.quote.gasFee,
        penaltyFeeWei: quote.quote.penaltyFee,
        totalWei,
      },
    };
  }

  /**
   * Assemble the parameters an agent needs to call `registerPegin()` on the
   * LBC contract as a recovery step. The LP normally handles registration
   * automatically — only call this if `pollStatus()` shows the peg-in is stuck.
   *
   * The RSK tx the agent must construct:
   *   - to: `info.lbcAddress`
   *   - value: `info.valueRbtc` (0n)
   *   - data: ABI-encoded `registerPegin(quote, signature, btcRawTransaction,
   *             partialMerkleTree, height)`
   *
   * The BTC SPV arguments (`btcRawTransaction`, `partialMerkleTree`, `height`)
   * must be fetched from a Bitcoin node using `userBtcTxHash`. Call
   * `adapter.connectToBitcoin(new Mempool({ network }))` then use
   * `adapter.registerPegin(plan, userBtcTxHash)` to have the SDK handle the
   * SPV proof fetch and broadcast automatically.
   */
  getRegisterPegInInfo(
    plan: PegInPaymentPlan,
    userBtcTxHash: string,
  ): RegisterPegInInfo {
    return {
      lbcAddress: plan.lbcAddress,
      valueRbtc: 0n,
      quote: plan.quote,
      lpSignature: plan.lpSignature,
      userBtcTxHash,
    };
  }

  /**
   * Validate a signed BTC transaction against the peg-in plan **before broadcasting**.
   * Returns an empty string if valid, or a human-readable error message if invalid.
   *
   * Pass the raw hex-encoded BTC transaction (no witness data required). The SDK
   * checks that the output sends the correct amount to the correct deposit address.
   * Call this after building the BTC tx with OWS but before broadcasting it.
   */
  async validatePegInTransaction(
    plan: PegInPaymentPlan,
    rawBtcTxHex: string,
  ): Promise<string> {
    return this.flyover.validatePeginTransaction(
      {
        quoteInfo: plan.quote,
        acceptInfo: {
          bitcoinDepositAddressHash: plan.bitcoinDepositAddressHash,
          signature: plan.lpSignature,
        },
        btcTx: rawBtcTxHex,
      },
      { throwError: false },
    );
  }

  /**
   * Recovery path: call `registerPegin` on the LBC contract directly.
   * Requires both `connectToBitcoin()` and `connectToRsk()` (with a signer)
   * to have been called first. The SDK fetches the BTC SPV proof automatically.
   * Only needed if the LP does not register the peg-in automatically.
   */
  async registerPegIn(
    plan: PegInPaymentPlan,
    userBtcTxHash: string,
  ): Promise<string> {
    return this.flyover.registerPegin({
      quote: plan.quote,
      providerSignature: plan.lpSignature,
      userBtcTransactionHash: userBtcTxHash,
    });
  }

  /**
   * Implements `BridgeAdapter.initiateDeposit`. Delegates to
   * `getPeginPaymentPlan()` and maps the result to `BridgeDepositResult`.
   * Prefer `getPeginPaymentPlan()` directly when you need the full plan
   * (deposit amount, deadline, fees, recovery context).
   */
  async initiateDeposit(
    amountSats: bigint,
    recipientAddress: string,
  ): Promise<BridgeDepositResult> {
    const plan = await this.getPegInPaymentPlan(amountSats, recipientAddress);
    return {
      depositAddress: plan.depositAddress,
      estimatedMintTimeSecs: this.estimateMintTime(),
      trackingId: plan.quoteHash,
      description:
        "Send BTC to the Flyover deposit address to mint RBTC on Rootstock.",
    };
  }

  async pollStatus(trackingId: string): Promise<BridgeStatusResult> {
    await this.ensureLiquidityProvider();
    const status = await this.flyover.getPeginStatus(trackingId);
    const state = status.status.state;
    const mapped = this.mapPeginState(state);

    return {
      status: mapped,
      sourceTxid: status.status.userBtcTxHash || undefined,
      destinationTxid:
        status.status.callForUserTxHash || status.status.registerPeginTxHash || undefined,
      message: state,
    };
  }

  async getPegoutQuote(
    amountSats: bigint,
    btcRecipientAddress: string,
    rskRefundAddress: string,
  ): Promise<RootstockPegoutQuoteResult> {
    if (amountSats <= 0n) {
      throw new Error("amountSats must be greater than 0");
    }

    await this.ensureLiquidityProvider();

    const quoteRequest = {
      to: btcRecipientAddress,
      rskRefundAddress,
      valueToTransfer: satsToWei(amountSats),
    };

    const quotes = await this.flyover.getPegoutQuotes(quoteRequest);
    const quote = quotes.at(0);
    if (!quote) {
      throw new Error("no peg-out quotes returned by Flyover liquidity providers");
    }

    const accepted = await this.flyover.acceptPegoutQuote(quote);
    const totalAmountWei = FlyoverUtils.getQuoteTotal(quote);

    return {
      quote,
      acceptedQuote: accepted,
      quoteHash: quote.quoteHash,
      totalAmountWei,
      totalAmountSats: weiToSats(totalAmountWei),
      lbcAddress: accepted.lbcAddress,
      signature: accepted.signature,
    };
  }

  async depositPegout(
    quote: PegoutQuote,
    signature: string,
    amountWei?: bigint,
  ): Promise<string> {
    const total = amountWei ?? FlyoverUtils.getQuoteTotal(quote);
    return this.flyover.depositPegout(quote, signature, total);
  }

  async getPegoutStatus(trackingId: string): Promise<BridgeStatusResult> {
    await this.ensureLiquidityProvider();
    const status: PegoutQuoteStatus = await this.flyover.getPegoutStatus(trackingId);
    const state = status.status.state;
    const mapped = this.mapPegoutState(state);

    return {
      status: mapped,
      sourceTxid: status.status.userRskTxHash || undefined,
      destinationTxid: status.status.lpBtcTxHash || status.status.bridgeRefundTxHash || undefined,
      message: state,
    };
  }

  private async ensureLiquidityProvider(): Promise<void> {
    if (this.flyover.getSelectedLiquidityProvider()) {
      return;
    }

    const providers = await this.flyover.getLiquidityProviders();
    const provider = providers.at(this.providerIndex);
    if (!provider) {
      throw new Error("no Flyover liquidity providers available for selected network");
    }

    this.flyover.useLiquidityProvider(provider);
  }

  private mapPeginState(state: string): BridgeStatus {
    const simple = FlyoverUtils.getSimpleQuoteStatus(state);

    if (simple === "SUCCESS") {
      return "completed";
    }

    if (simple === "FAILED" || simple === "EXPIRED") {
      return "failed";
    }

    if (state === "WaitingForDepositConfirmations") {
      return "confirming";
    }

    if (state === "CallForUserSucceeded" || state === "RegisterPegInSucceeded") {
      return "minting";
    }

    return "pending";
  }

  private mapPegoutState(state: string): BridgeStatus {
    const simple = FlyoverUtils.getSimpleQuoteStatus(state);

    if (simple === "SUCCESS") {
      return "completed";
    }

    if (simple === "FAILED" || simple === "EXPIRED") {
      return "failed";
    }

    if (state === "WaitingForDepositConfirmations") {
      return "confirming";
    }

    if (state === "BridgeTxSucceeded") {
      return "minting";
    }

    return "pending";
  }
}
