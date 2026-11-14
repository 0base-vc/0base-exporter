import {
  DEFAULT_CONFIG,
  DsSamSDK,
  InputsSource,
  LogVerbosity,
  defaultDataProviderBuilder,
  type DsSamConfig,
  type RawSourceData,
} from "@marinade.finance/ds-sam-sdk";

export const MARINADE_LIVE_MAX_AGE_MS = 180_000;
const CONFIG_URL =
  "https://thru.marinade.finance/marinade-finance/ds-sam-pipeline/main/auction-config.json";

type LiveAuction = {
  winningTotalPmpe: number;
  auctionData: {
    epoch: number;
    validators: {
      voteAccount: string;
      revShare: { totalPmpe: number; bidPmpe: number };
      values: {
        commissions: { inflationCommissionDec: number | null; mevCommissionDec: number };
      };
    }[];
  };
};

export type MarinadeLiveReference = {
  epoch: number;
  validators: {
    vote: string;
    commission: string;
    mevCommission: string;
    bid: number;
    minimumBid: number;
    margin: number;
  }[];
};

export function liveMarinadeBidReferences(
  auction: LiveAuction,
  votes: string[],
): MarinadeLiveReference {
  const cutoff = auction?.winningTotalPmpe;
  const epoch = auction?.auctionData?.epoch;
  if (!Number.isFinite(cutoff) || cutoff <= 0 || !Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error("Invalid live Marinade auction");
  }
  const validators = votes.map((vote) => {
    const validator = auction.auctionData.validators.find((row) => row.voteAccount === vote);
    const total = validator?.revShare?.totalPmpe;
    const bid = validator?.revShare?.bidPmpe;
    const commission = validator?.values?.commissions?.inflationCommissionDec;
    const mevCommission = validator?.values?.commissions?.mevCommissionDec;
    if (
      ![total, bid, commission, mevCommission].every((value) => Number.isFinite(value)) ||
      bid < 0 ||
      commission > 1 ||
      mevCommission > 1
    ) {
      throw new Error(`Missing or invalid live Marinade validator: ${vote}`);
    }
    // Exactly the live PSR comparison, using revenue and bid from the SAME run.
    // Non-bid revenue includes inflation, MEV and any shared block rewards.
    return {
      vote,
      commission: String(Number((commission * 100).toPrecision(12))),
      mevCommission: String(Number((mevCommission * 100).toPrecision(12))),
      bid,
      minimumBid: Math.max(0, cutoff - (total - bid)),
      margin: total - cutoff,
    };
  });
  return { epoch, validators };
}

export async function fetchLiveMarinadeAuction(votes: string[]): Promise<MarinadeLiveReference> {
  // Bound the WHOLE run's network work, including response bodies. Never use the
  // exporter's stale-fallback HTTP cache as inputs to an actionable live alert.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const read = async <T>(url: string, text = false): Promise<T> => {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Marinade input HTTP ${response.status}: ${url}`);
    return (text ? await response.text() : await response.json()) as T;
  };
  try {
    const config: DsSamConfig = {
      ...DEFAULT_CONFIG,
      ...(await read<Partial<DsSamConfig>>(CONFIG_URL)),
      inputsSource: InputsSource.APIS,
      cacheInputs: false,
      logVerbosity: LogVerbosity.ERROR,
      debugVoteAccounts: [],
    };
    const epochs = 1 + Math.max(config.validatorsUptimeEpochsCount, config.rewardsEpochsCount);
    const [validators, mevInfo, bonds, tvlInfo, blacklist, rewards, auctions] = await Promise.all([
      read<RawSourceData["validators"]>(
        `${config.validatorsApiBaseUrl}/validators?epochs=${epochs}&limit=1000000`,
      ),
      read<RawSourceData["mevInfo"]>(`${config.validatorsApiBaseUrl}/mev`),
      read<RawSourceData["bonds"]>(`${config.bondsApiBaseUrl}/bonds/bidding`),
      read<RawSourceData["tvlInfo"]>(`${config.tvlInfoApiBaseUrl}/tlv`),
      read<string>(`${config.blacklistApiBaseUrl}/blacklist.csv`, true),
      read<RawSourceData["rewards"]>(
        `${config.validatorsApiBaseUrl}/rewards?epochs=${config.rewardsEpochsCount}`,
      ),
      read<RawSourceData["auctions"]>(
        `${config.scoringApiBaseUrl}/api/v1/scores/sam?lastEpochs=${config.bidTooLowPenaltyHistoryEpochs + 1}`,
      ),
    ]);
    // Match SDK 0.6.7's public API provider normalization, including Alpenglow
    // vote rewards when credits are null. Only transport is replaced for bounds.
    validators.validators = validators.validators.filter((validator) =>
      validator.epoch_stats
        .slice(0, 3)
        .some((epoch) => (epoch.credits ?? 0) > 0 || (epoch.vote_reward_lamports ?? 0) > 0),
    );
    for (const row of auctions) {
      const share = row.revShare;
      share.activatingStakePmpe ??= 0;
      share.blockPmpe ??= 0;
      share.bondObligationPmpe ??= share.bidPmpe;
      share.onchainDistributedPmpe ??= share.inflationPmpe + share.mevPmpe;
    }
    const source: RawSourceData = {
      validators,
      mevInfo,
      bonds,
      tvlInfo,
      blacklist,
      rewards,
      auctions,
    };
    const sdk = new DsSamSDK(config, (sdkConfig) => {
      const provider = defaultDataProviderBuilder(sdkConfig);
      provider.fetchSourceData = async () => source;
      return provider;
    });
    return liveMarinadeBidReferences(await sdk.runFinalOnly(), votes);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
