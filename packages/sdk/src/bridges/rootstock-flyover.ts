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

const SATS_TO_WEI_FACTOR = 10_000_000_000n;

function satsToWei(sats: bigint): bigint {
  return sats * SATS_TO_WEI_FACTOR;
}

function weiToSats(wei: bigint): bigint {
  return wei / SATS_TO_WEI_FACTOR;
}

export interface RootstockFlyoverAdapterOptions {
  testnet?: boolean;
  providerIndex?: number;
  minDepositSats?: bigint;
  captchaTokenResolver?: () => Promise<string>;
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
    this.minDepositSats = options.minDepositSats ?? 1n;
    this.providerIndex = options.providerIndex ?? 0;

    this.flyover = new Flyover({
      network: testnet ? "Testnet" : "Mainnet",
      captchaTokenResolver:
        options.captchaTokenResolver ?? (async () => Promise.resolve("")),
    });
  }

  estimateMintTime(): number {
    // Conservative default for peg-in finalization through LP flow.
    return 15 * 60;
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

  async initiateDeposit(
    amountSats: bigint,
    recipientAddress: string,
  ): Promise<BridgeDepositResult> {
    if (amountSats <= 0n) {
      throw new Error("amountSats must be greater than 0");
    }

    await this.ensureLiquidityProvider();

    const quoteRequest = {
      callContractArguments: "0x",
      callEoaOrContractAddress: recipientAddress,
      rskRefundAddress: recipientAddress,
      valueToTransfer: satsToWei(amountSats),
    };

    const quotes = await this.flyover.getQuotes(quoteRequest);
    const quote = quotes.at(0);
    if (!quote) {
      throw new Error("no peg-in quotes returned by Flyover liquidity providers");
    }

    await this.flyover.acceptQuote(quote);

    const status = await this.flyover.getPeginStatus(quote.quoteHash);
    const depositAddress =
      status.status.depositAddress || status.detail.lpBTCAddr || status.detail.fedBTCAddr;

    if (!depositAddress) {
      throw new Error("Flyover did not return a BTC deposit address for the accepted quote");
    }

    return {
      depositAddress,
      estimatedMintTimeSecs: this.estimateMintTime(),
      trackingId: quote.quoteHash,
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
