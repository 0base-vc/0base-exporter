import TargetAbstract from "../target.abstract";
import { Gauge, Registry } from "prom-client";
import * as _ from "lodash";
import {
  createSolanaEpochLabelResolver,
  emitZeroSolanaVxIncomeMetrics,
  emitZeroSolanaVxMedianAverages,
  updateSolanaBlockProduction,
  updateSolanaBalances,
  updateSolanaClusterRequiredVersions,
  updateSolanaLeaderWindowsAndEpochEnd,
  updateSolanaVoteAccounts,
} from "./shared/solana-common";
// Uses TargetAbstract caching helpers instead of axios directly.

const LAMPORTS_PER_SOL = 1e9;
const SOLANA_INDEXER_BASE_URL = "https://whoearns.live";

type SolanaSlotsOrFeesStatus = "final" | "live" | "no_data" | "not_tracked";
type SolanaMevStatus = "final" | "approximate" | "no_data";

type SolanaIndexerValidatorRecord = {
  vote?: string;
  identity?: string;
  epoch?: number | string;
  slotsStatus?: SolanaSlotsOrFeesStatus;
  slotsAssigned?: number | null;
  slotsProduced?: number | null;
  slotsSkipped?: number | null;
  feesStatus?: SolanaSlotsOrFeesStatus;
  blockFeesTotalSol?: string | number | null;
  mevStatus?: SolanaMevStatus;
  mevRewardsSol?: string | number | null;
};

type SolanaIndexerBatchResponse = {
  epoch?: number | string;
  results?: SolanaIndexerValidatorRecord[];
  missing?: string[];
};

function toFiniteMetricValue(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default class Solana extends TargetAbstract {
  private readonly metricPrefix = "solana";

  private readonly registry = new Registry();

  private readonly balanceGauge = new Gauge({
    name: `${this.metricPrefix}_address_balance`,
    help: "Total balance of address",
    labelNames: ["address"],
  });

  private readonly availableGauge = new Gauge({
    name: `${this.metricPrefix}_address_available`,
    help: "Available balance of address",
    labelNames: ["address"],
  });

  private readonly activatedStakeGauge = new Gauge({
    name: `${this.metricPrefix}_validator_activated_stake`,
    help: "Your activated stake",
    labelNames: ["vote"],
  });

  private readonly activeGauge = new Gauge({
    name: `${this.metricPrefix}_validator_active`,
    help: "Your validator active",
    labelNames: ["vote"],
  });

  private readonly commissionGauge = new Gauge({
    name: `${this.metricPrefix}_validator_commission`,
    help: "Your validator commission",
    labelNames: ["vote"],
  });

  private readonly validatorBondsGauge = new Gauge({
    name: `${this.metricPrefix}_validator_bonds`,
    help: "Your validator bonds",
    labelNames: ["vote"],
  });

  private readonly delegationBySourceGauge = new Gauge({
    name: `${this.metricPrefix}_delegation_sol`,
    help: "Delegations to validator by source",
    labelNames: ["vote", "source"],
  });

  private readonly pendingActivationBySourceGauge = new Gauge({
    name: `${this.metricPrefix}_pending_activation_sol`,
    help: "Pending activation stake by source",
    labelNames: ["vote", "source"],
  });

  private readonly pendingDeactivationBySourceGauge = new Gauge({
    name: `${this.metricPrefix}_pending_deactivation_sol`,
    help: "Pending deactivation stake by source",
    labelNames: ["vote", "source"],
  });

  private readonly marinadeMinEffectiveBidGauge = new Gauge({
    name: `${this.metricPrefix}_marinade_min_effective_bid_sol`,
    help: "Minimum effective bid required to receive delegation from Marinade (pmpe)",
    labelNames: ["vote", "commission", "mev_commission"],
  });

  private readonly marinadeMyBidGauge = new Gauge({
    name: `${this.metricPrefix}_marinade_my_bid_sol`,
    help: "Current bid value our validator has set in Marinade",
    labelNames: ["vote"],
  });

  private readonly marinadeMaxStakeWantedGauge = new Gauge({
    name: `${this.metricPrefix}_marinade_max_stake_wanted_sol`,
    help: "Maximum stake wanted by validator in Marinade",
    labelNames: ["vote"],
  });

  private readonly slotsAssignedGauge = new Gauge({
    name: `${this.metricPrefix}_slots_assigned_total`,
    help: "Total number of leader slots assigned to our validator in the current epoch",
    labelNames: ["vote", "epoch"],
  });

  private readonly slotsProducedGauge = new Gauge({
    name: `${this.metricPrefix}_slots_produced_total`,
    help: "Number of leader slots we successfully produced in the current epoch",
    labelNames: ["vote", "epoch"],
  });

  private readonly slotsSkippedGauge = new Gauge({
    name: `${this.metricPrefix}_slots_skipped_total`,
    help: "Number of leader slots assigned but not produced in the current epoch",
    labelNames: ["vote", "epoch"],
  });

  private readonly blockFeesTotalGauge = new Gauge({
    name: `${this.metricPrefix}_block_fees_total_sol`,
    help: "Total transaction fees from blocks we produced",
    labelNames: ["vote", "epoch"],
  });

  private readonly mevFeesTotalGauge = new Gauge({
    name: `${this.metricPrefix}_mev_fees_total_sol`,
    help: "Total MEV-related fees collected",
    labelNames: ["vote", "epoch"],
  });

  private readonly slotsStatusGauge = new Gauge({
    name: `${this.metricPrefix}_slots_status`,
    help: "Indexer completeness status for Solana slot metrics; value is 1 for the active status",
    labelNames: ["vote", "epoch", "status"],
  });

  private readonly blockFeesStatusGauge = new Gauge({
    name: `${this.metricPrefix}_block_fees_status`,
    help: "Indexer completeness status for Solana block fee metrics; value is 1 for the active status",
    labelNames: ["vote", "epoch", "status"],
  });

  private readonly mevFeesStatusGauge = new Gauge({
    name: `${this.metricPrefix}_mev_fees_status`,
    help: "Indexer completeness status for Solana MEV fee metrics; value is 1 for the active status",
    labelNames: ["vote", "epoch", "status"],
  });

  private readonly blockTipsMedianGauge = new Gauge({
    name: `${this.metricPrefix}_block_tips_median_sol`,
    help: "Median block tips per produced block",
    labelNames: ["vote", "epoch"],
  });

  // Epoch-level average of median incomes for top 50 by stake (vx.tools leaderboard)
  private readonly epochMedianBaseFeesAvgGauge = new Gauge({
    name: `${this.metricPrefix}_epoch_median_base_fees_avg_sol`,
    help: "Average of median base fees among top 50 validators by stake for the epoch",
    labelNames: ["epoch"],
  });
  private readonly epochMedianPriorityFeesAvgGauge = new Gauge({
    name: `${this.metricPrefix}_epoch_median_priority_fees_avg_sol`,
    help: "Average of median priority fees among top 50 validators by stake for the epoch",
    labelNames: ["epoch"],
  });
  private readonly epochMedianMevTipsAvgGauge = new Gauge({
    name: `${this.metricPrefix}_epoch_median_mev_tips_avg_sol`,
    help: "Average of median MEV tips among top 50 validators by stake for the epoch",
    labelNames: ["epoch"],
  });

  private readonly clusterRequiredVersionGauge = new Gauge({
    name: `${this.metricPrefix}_cluster_required_versions`,
    help: "Cluster required client versions (Agave/Frankendancer) labeled as strings; value equals epoch",
    labelNames: ["min_version_agave", "min_version_frankendancer"],
  });

  private readonly validatorReleaseVersionGauge = new Gauge({
    name: `${this.metricPrefix}_validator_release_version`,
    help: "Validator release client version labeled as string; value fixed to 1",
    labelNames: ["vote", "release_version"],
  });

  private readonly leaderSlotNextTsGauge = new Gauge({
    name: `${this.metricPrefix}_leader_slot_next_timestamp`,
    help: "Estimated timestamp (unix seconds) for first slot of upcoming 4-slot leader windows",
    labelNames: ["identity", "epoch", "slot"],
  });

  private readonly leaderSlotRewardTsGauge = new Gauge({
    name: `${this.metricPrefix}_leader_slot_reward_timestamp`,
    help: "Timestamp for past 4-slot leader window starts with summed Fee rewards (SOL) as label",
    labelNames: ["identity", "epoch", "slot", "rewards"],
  });

  private readonly epochEndTsGauge = new Gauge({
    name: `${this.metricPrefix}_epoch_end_timestamp`,
    help: "Estimated unix seconds when current epoch ends",
    labelNames: ["epoch"],
  });

  private readonly epochStateGauge = new Gauge({
    name: `${this.metricPrefix}_epoch_state`,
    help: "Current and previous epoch markers (value is always 1)",
    labelNames: ["kind", "epoch"],
  });

  private readonly marinadeEffectiveBidEpochGauge = new Gauge({
    name: `${this.metricPrefix}_marinade_effective_bid_epoch`,
    help: "Marinade effective bid per epoch (pmpe) per vote account with unstake priority and stake priority labels",
    labelNames: ["vote", "epoch", "unstake_priority", "stake_priority"],
  });

  // validator voteAccount -> node identity mapping
  private validatorToIdentityMap: Record<string, string> = {};

  // vx.tools cache TTL handled through postWithCache.
  private readonly VX_CACHE_TTL_MS = 60000;
  private readonly INDEXER_CACHE_TTL_MS = 30000;

  // Cache for effective bid values computed from the Marinade SDK.
  private sdkEffBidCache: {
    ts: number;
    winningTotalPmpe: number;
    inflationPmpe: number;
    mevPmpe: number;
  } | null = null;
  private readonly SDK_CACHE_TTL_MS = 30 * 60 * 1000;

  // Cached Marinade metadata such as advertised commission and MEV BPS.
  private validatorsAdvCache: { ts: number; map: Record<string, number> } | null = null;
  private mevBpsCache: { ts: number; map: Record<string, number> } | null = null;
  private readonly META_TTL_MS = 10 * 60 * 1000;

  private toUniqueList(csv: string): string[] {
    return Array.from(
      new Set(
        csv
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    );
  }

  // private readonly rankGauge = new Gauge({
  //     name: `${this.metricPrefix}_validator_rank`,
  //     help: 'Your validator rank',
  //     labelNames: ['validator']
  // });

  // private readonly rootSlotGauge = new Gauge({
  //     name: `${this.metricPrefix}_validator_root_slot`,
  //     help: 'Your validator root slot',
  //     labelNames: ['validator']
  // });

  private readonly lastVoteGauge = new Gauge({
    name: `${this.metricPrefix}_validator_last_vote`,
    help: "Your validator last vote",
    labelNames: ["vote"],
  });

  // private readonly validatorsCount = new Gauge({
  //     name: `${this.metricPrefix}_validators_count`,
  //     help: 'Validators count',
  // });

  public constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly votes: string,
    protected readonly identities: string,
    protected readonly walletAddresses: string = "",
  ) {
    super(existMetrics, apiUrl, rpcUrl, votes, identities);

    this.registry.registerMetric(this.balanceGauge);
    this.registry.registerMetric(this.availableGauge);
    this.registry.registerMetric(this.activatedStakeGauge);

    this.registry.registerMetric(this.activeGauge);
    this.registry.registerMetric(this.commissionGauge);
    this.registry.registerMetric(this.validatorBondsGauge);
    this.registry.registerMetric(this.lastVoteGauge);
    this.registry.registerMetric(this.delegationBySourceGauge);
    this.registry.registerMetric(this.pendingActivationBySourceGauge);
    this.registry.registerMetric(this.pendingDeactivationBySourceGauge);
    this.registry.registerMetric(this.marinadeMinEffectiveBidGauge);
    this.registry.registerMetric(this.marinadeMyBidGauge);
    this.registry.registerMetric(this.marinadeMaxStakeWantedGauge);
    this.registry.registerMetric(this.slotsAssignedGauge);
    this.registry.registerMetric(this.slotsProducedGauge);
    this.registry.registerMetric(this.slotsSkippedGauge);
    this.registry.registerMetric(this.blockFeesTotalGauge);
    this.registry.registerMetric(this.mevFeesTotalGauge);
    this.registry.registerMetric(this.slotsStatusGauge);
    this.registry.registerMetric(this.blockFeesStatusGauge);
    this.registry.registerMetric(this.mevFeesStatusGauge);
    this.registry.registerMetric(this.blockTipsMedianGauge);
    this.registry.registerMetric(this.clusterRequiredVersionGauge);
    this.registry.registerMetric(this.validatorReleaseVersionGauge);
    this.registry.registerMetric(this.epochMedianBaseFeesAvgGauge);
    this.registry.registerMetric(this.epochMedianPriorityFeesAvgGauge);
    this.registry.registerMetric(this.epochMedianMevTipsAvgGauge);
    this.registry.registerMetric(this.leaderSlotNextTsGauge);
    this.registry.registerMetric(this.leaderSlotRewardTsGauge);
    this.registry.registerMetric(this.epochEndTsGauge);
    this.registry.registerMetric(this.marinadeEffectiveBidEpochGauge);
    this.registry.registerMetric(this.epochStateGauge);
  }

  public async makeMetrics(): Promise<string> {
    let customMetrics = "";
    try {
      // 1) Build the vote-account to identity mapping first with a single getVoteAccounts call.
      await this.updateVoteAccounts(this.votes);

      // 2) Run independent tasks in parallel.
      const balanceTargets = [this.votes, this.identities, this.walletAddresses]
        .filter(Boolean)
        .join(",");
      await Promise.all([
        this.updateBalance(balanceTargets),
        this.updateDelegationsFromJPool(this.votes),
        this.updatePendingStakeFromJPool(this.votes),
        this.updateMarinadeScoring(this.votes),
        this.updateGlobalEffectiveBid(),
        this.updateClusterRequiredVersions(),
        this.updateValidatorReleaseVersions(),
        this.updateLeaderWindowsAndEpochEnd(),
        this.updateMarinadeEffectiveBidEpoch(),
        this.updateCurrentEpochMetricsFromIndexer(this.votes),
      ]);

      customMetrics = await this.registry.metrics();
    } catch (e) {
      console.error("makeMetrics", e);
    }

    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  private async updateLeaderWindowsAndEpochEnd(): Promise<void> {
    await updateSolanaLeaderWindowsAndEpochEnd({
      identities: this.identities,
      rpcUrl: this.rpcUrl,
      performanceRpcUrl: "https://api.mainnet-beta.solana.com",
      leaderSlotNextTsGauge: this.leaderSlotNextTsGauge,
      leaderSlotRewardTsGauge: this.leaderSlotRewardTsGauge,
      epochEndTsGauge: this.epochEndTsGauge,
      epochStateGauge: this.epochStateGauge,
      post: this.post.bind(this),
      postWithCache: this.postWithCache.bind(this),
      postImmutableWithLRU: this.postImmutableWithLRU.bind(this),
    });
  }

  private async updateBalance(addresses: string): Promise<void> {
    await updateSolanaBalances({
      addresses,
      rpcUrl: this.rpcUrl,
      availableGauge: this.availableGauge,
      balanceGauge: this.balanceGauge,
      postWithCache: this.postWithCache.bind(this),
    });
  }

  // Collect delegation totals by source for each validator from JPool.
  private async updateDelegationsFromJPool(validators: string): Promise<void> {
    this.delegationBySourceGauge.reset();
    const voteAccounts = this.toUniqueList(validators);
    await Promise.all(
      voteAccounts.map(async (vote) => {
        try {
          const url = `https://api.jpool.one/delegation?vote=${vote}`;
          const arr = await this.getWithCache(
            url,
            (response: { data: any }) => response.data,
            this.getRandomCacheDuration(60000, 15000),
            10000,
          );
          if (Array.isArray(arr)) {
            for (const item of arr) {
              const source = String(item.stake_type || item.stakeType || "unknown");
              const amountLamports = Number(item.stake_amount ?? 0);
              const amountSol = amountLamports / LAMPORTS_PER_SOL;
              this.delegationBySourceGauge.labels(vote, source).set(amountSol);
            }
          }
        } catch (e) {
          console.error("updateDelegationsFromJPool", e);
        }
      }),
    );
  }

  private async updateVoteAccounts(validators: string): Promise<void> {
    await updateSolanaVoteAccounts({
      validators,
      rpcUrl: this.rpcUrl,
      activatedStakeGauge: this.activatedStakeGauge,
      activeGauge: this.activeGauge,
      commissionGauge: this.commissionGauge,
      lastVoteGauge: this.lastVoteGauge,
      post: this.post.bind(this),
      onNodePubkey: (vote, nodePubkey) => {
        this.validatorToIdentityMap[vote] = nodePubkey;
      },
    });
  }

  public async updateBlockProductionFromRpc(validators: string): Promise<void> {
    try {
      await updateSolanaBlockProduction({
        validators,
        validatorToIdentityMap: this.validatorToIdentityMap,
        rpcUrl: this.rpcUrl,
        slotsAssignedGauge: this.slotsAssignedGauge,
        slotsProducedGauge: this.slotsProducedGauge,
        slotsSkippedGauge: this.slotsSkippedGauge,
        postWithCache: this.postWithCache.bind(this),
      });
    } catch (error) {
      console.error("updateBlockProductionFromRpc", error);
    }
  }

  private resetIndexerManagedGauges(): void {
    this.slotsAssignedGauge.reset();
    this.slotsProducedGauge.reset();
    this.slotsSkippedGauge.reset();
    this.blockFeesTotalGauge.reset();
    this.mevFeesTotalGauge.reset();
    this.slotsStatusGauge.reset();
    this.blockFeesStatusGauge.reset();
    this.mevFeesStatusGauge.reset();
    this.blockTipsMedianGauge.reset();
    this.epochMedianBaseFeesAvgGauge.reset();
    this.epochMedianPriorityFeesAvgGauge.reset();
    this.epochMedianMevTipsAvgGauge.reset();
  }

  private getSolanaIndexerBatchUrl(): string {
    return `${SOLANA_INDEXER_BASE_URL}/v1/validators/current-epoch/batch`;
  }

  public async updateCurrentEpochMetricsFromIndexer(validators: string): Promise<void> {
    this.resetIndexerManagedGauges();

    const voteAccounts = this.toUniqueList(validators);
    if (voteAccounts.length === 0) {
      return;
    }

    try {
      const response = await this.postWithCache(
        this.getSolanaIndexerBatchUrl(),
        { votes: voteAccounts },
        (rawResponse: { data: unknown }) => rawResponse.data as SolanaIndexerBatchResponse,
        this.INDEXER_CACHE_TTL_MS,
        10000,
      );

      const results = Array.isArray(response?.results) ? response.results : [];
      for (const record of results) {
        const vote = record.vote?.trim() ?? "";
        const epochLabel =
          record.epoch !== undefined && record.epoch !== null ? String(record.epoch) : "";
        if (!vote || !epochLabel) {
          continue;
        }

        if (record.identity?.trim()) {
          this.validatorToIdentityMap[vote] = record.identity.trim();
        }

        if (record.slotsStatus) {
          this.slotsStatusGauge.labels(vote, epochLabel, record.slotsStatus).set(1);
        }

        const slotsAssigned = toFiniteMetricValue(record.slotsAssigned);
        const slotsProduced = toFiniteMetricValue(record.slotsProduced);
        const slotsSkipped = toFiniteMetricValue(record.slotsSkipped);

        if (slotsAssigned !== null) {
          this.slotsAssignedGauge.labels(vote, epochLabel).set(slotsAssigned);
        }
        if (slotsProduced !== null) {
          this.slotsProducedGauge.labels(vote, epochLabel).set(slotsProduced);
        }
        if (slotsSkipped !== null) {
          this.slotsSkippedGauge.labels(vote, epochLabel).set(slotsSkipped);
        }

        if (record.feesStatus) {
          this.blockFeesStatusGauge.labels(vote, epochLabel, record.feesStatus).set(1);
        }

        const blockFeesTotalSol = toFiniteMetricValue(record.blockFeesTotalSol);
        if (blockFeesTotalSol !== null) {
          this.blockFeesTotalGauge.labels(vote, epochLabel).set(blockFeesTotalSol);
        }

        if (record.mevStatus) {
          this.mevFeesStatusGauge.labels(vote, epochLabel, record.mevStatus).set(1);
        }

        const mevRewardsSol = toFiniteMetricValue(record.mevRewardsSol);
        if (mevRewardsSol !== null) {
          this.mevFeesTotalGauge.labels(vote, epochLabel).set(mevRewardsSol);
        }
      }
    } catch (error) {
      console.error("updateCurrentEpochMetricsFromIndexer", error);
    }
  }

  // Epoch-scoped fee gauges are updated only by updateEpochIncomeFromVx.

  private async updateClusterRequiredVersions(): Promise<void> {
    await updateSolanaClusterRequiredVersions({
      cluster: "mainnet-beta",
      clusterRequiredVersionGauge: this.clusterRequiredVersionGauge,
      getWithCache: this.getWithCache.bind(this),
    });
  }

  private async updateValidatorReleaseVersions(): Promise<void> {
    try {
      this.validatorReleaseVersionGauge.reset();
      const voteAccounts = this.toUniqueList(this.votes);
      await Promise.all(
        voteAccounts.map(async (vote) => {
          try {
            const url = `https://api.jpool.one/validators/${encodeURIComponent(vote)}`;
            const data = await this.getWithCache(
              url,
              (response: { data: any }) => response.data,
              60000,
              10000,
            );
            const releaseVersion: string = String(data?.version ?? "");
            if (releaseVersion) {
              this.validatorReleaseVersionGauge.labels(vote, releaseVersion).set(1);
            }
          } catch (inner) {
            console.error(`updateValidatorReleaseVersions ${vote}`, inner);
          }
        }),
      );
    } catch (e) {
      console.error("updateValidatorReleaseVersions", e);
    }
  }

  // Marinade scoring API → bid, min effective bid, bonds(=bondBalanceSol)
  private async updateMarinadeScoring(validators: string): Promise<void> {
    try {
      this.marinadeMyBidGauge.reset();
      this.marinadeMaxStakeWantedGauge.reset();
      this.validatorBondsGauge.reset();

      // 1. Fetch the scoring API with cache protection to avoid repeated requests.
      const scoringUrl = "https://scoring.marinade.finance/api/v1/scores/sam?lastEpochs=4";
      const scoringList = await this.getWithCache(
        scoringUrl,
        (response: { data: any }) => response.data,
        30 * 60 * 1000,
        25000,
      );

      // 2. Fetch bidPmpe, maxStakeWanted, and bondBalanceSol from the bonds API.
      const bondsUrl = "https://validator-bonds-api.marinade.finance/bonds";
      const bondsResponse = await this.getWithCache(
        bondsUrl,
        (response: { data: any }) => response.data,
        30 * 60 * 1000,
        25000,
      );
      const bondsList = bondsResponse?.bonds || [];

      // 3. Commission and MEV commission loading is intentionally skipped for now because
      // they are not currently used in the my_bid labels.

      if (!Array.isArray(scoringList) || !Array.isArray(bondsList)) return;

      const voteAccounts = validators
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      for (const vote of voteAccounts) {
        // Find the minEffectiveBid entry from the scoring API.
        const scoringFound = scoringList.find((it: any) => it && it.voteAccount === vote);

        // Find the remaining values in the bonds API payload.
        const bondsFound = bondsList.find((it: any) => it && it.vote_account === vote);
        if (bondsFound) {
          const bidPmpe = Number(bondsFound.cpmpe ?? 0) / 1e9; // Convert from lamports to SOL
          const maxStakeWanted = Number(bondsFound.max_stake_wanted ?? 0) / 1e9; // Convert from lamports to SOL
          const bondBalanceSol = Number(bondsFound.funded_amount ?? 0) / 1e9; // Convert from lamports to SOL

          this.marinadeMyBidGauge.labels(vote).set(bidPmpe);
          this.marinadeMaxStakeWantedGauge.labels(vote).set(maxStakeWanted);
          this.validatorBondsGauge.labels(vote).set(bondBalanceSol);
        } else if (scoringFound) {
          // Fall back to the scoring API values when the bonds API has no entry.
          const bidPmpe = Number(scoringFound?.revShare?.bidPmpe ?? 0);
          const maxStakeWanted = Number(scoringFound?.maxStakeWanted ?? 0);
          const bondBalanceSol = Number(scoringFound?.values?.bondBalanceSol ?? 0);

          this.marinadeMyBidGauge.labels(vote).set(bidPmpe);
          this.marinadeMaxStakeWantedGauge.labels(vote).set(maxStakeWanted);
          this.validatorBondsGauge.labels(vote).set(bondBalanceSol);
        }
      }
    } catch (e) {
      console.error("updateMarinadeScoring", e);
    }
  }

  // Store recent effectiveBid values from the Marinade scoring API for configured vote accounts.
  private async updateMarinadeEffectiveBidEpoch(): Promise<void> {
    try {
      this.marinadeEffectiveBidEpochGauge.reset();
      const configuredVotes = this.toUniqueList(this.votes);
      if (configuredVotes.length === 0) return;
      const url = "https://scoring.marinade.finance/api/v1/scores/sam?lastEpochs=4";
      const rows = await this.getWithCache(
        url,
        (response: { data: any }) => response.data,
        this.getRandomCacheDuration(30 * 60 * 1000, 15 * 1000),
        25000,
      );
      const arr: any[] = Array.isArray(rows) ? rows : [];
      for (const it of arr) {
        try {
          const vote = String(it?.voteAccount || "");
          if (!vote || !configuredVotes.includes(vote)) continue;
          const epoch = String(it?.epoch ?? "");
          if (!epoch) continue;
          const eff = Number(it?.effectiveBid ?? 0);
          if (!Number.isFinite(eff)) continue;
          const unstake = Number(it?.unstakePriority);
          const unstakeLabel = Number.isFinite(unstake) ? String(unstake) : "0";
          const stake = Number(it?.stakePriority);
          const stakeLabel = Number.isFinite(stake) ? String(stake) : "0";
          this.marinadeEffectiveBidEpochGauge
            .labels(vote, epoch, unstakeLabel, stakeLabel)
            .set(eff);
        } catch (inner) {
          console.error("updateMarinadeEffectiveBidEpoch item error", inner);
        }
      }
    } catch (e) {
      console.error("updateMarinadeEffectiveBidEpoch", e);
    }
  }

  // Build a vote-account map from commission_advertised values in the validators API.
  private async loadValidatorsAdvertisedCommission(): Promise<Record<string, number>> {
    try {
      const now = Date.now();
      if (this.validatorsAdvCache && now - this.validatorsAdvCache.ts < this.META_TTL_MS) {
        return this.validatorsAdvCache.map;
      }
      const url = "https://validators-api.marinade.finance/validators?limit=9999&epochs=1";
      const data = await this.getWithCache(
        url,
        (response: { data: any }) => response.data,
        this.getRandomCacheDuration(60000, 15000),
        25000,
      );
      const arr: any[] = Array.isArray(data?.validators) ? data.validators : [];
      const map: Record<string, number> = {};
      for (const it of arr) {
        const vote = String(it?.vote_account || it?.vote || "");
        if (!vote) continue;
        const adv = Number(it?.commission_advertised);
        if (Number.isFinite(adv)) map[vote] = adv;
      }
      this.validatorsAdvCache = { ts: now, map };
      return map;
    } catch (e) {
      console.error("loadValidatorsAdvertisedCommission", e);
      return {};
    }
  }

  // Build a vote-account map from mev_commission_bps values in the MEV API.
  private async loadMevCommissionBps(): Promise<Record<string, number>> {
    try {
      const now = Date.now();
      if (this.mevBpsCache && now - this.mevBpsCache.ts < this.META_TTL_MS) {
        return this.mevBpsCache.map;
      }
      const url = "https://validators-api.marinade.finance/mev";
      const data = await this.getWithCache(
        url,
        (response: { data: any }) => response.data,
        this.getRandomCacheDuration(60000, 15000),
        25000,
      );
      // Only process the expected `{ validators: [{ vote_account, mev_commission_bps, ... }] }` shape.
      const out: Record<string, number> = {};
      const arr: any[] = Array.isArray((data as any)?.validators) ? (data as any).validators : [];
      for (const it of arr) {
        const vote = String(it?.vote_account || "");
        const bps = Number(it?.mev_commission_bps);
        if (vote && Number.isFinite(bps)) out[vote] = bps;
      }
      this.mevBpsCache = { ts: now, map: out };
      return out;
    } catch (e) {
      console.error("loadMevCommissionBps", e);
      return {};
    }
  }

  // Compute the global effective bid and expose it with commission and mev_commission labels.
  private async updateGlobalEffectiveBid(): Promise<void> {
    try {
      this.marinadeMinEffectiveBidGauge.reset();

      const now = Date.now();
      let winningTotalPmpe: number;
      let baseInflPmpe: number;
      let baseMevPmpe: number;

      // 1) Reuse cached SDK output when it is still fresh.
      if (this.sdkEffBidCache && now - this.sdkEffBidCache.ts < this.SDK_CACHE_TTL_MS) {
        ({
          winningTotalPmpe,
          inflationPmpe: baseInflPmpe,
          mevPmpe: baseMevPmpe,
        } = this.sdkEffBidCache);
        await this.applyEffBidToVotes(winningTotalPmpe, baseInflPmpe, baseMevPmpe);
        return;
      }

      // 2) Run the SDK to compute fresh values.
      const configUrl =
        "https://raw.githubusercontent.com/marinade-finance/ds-sam-pipeline/main/auction-config.json";
      const config = await this.getWithCache(
        configUrl,
        (response: { data: any }) => response.data,
        60000,
        10000,
      );
      const req: any = (global as any).require ? (global as any).require : eval("require");
      const sdkMod: any = req("@marinade.finance/ds-sam-sdk");
      const dsSam = new sdkMod.DsSamSDK({
        ...config,
        inputsSource: sdkMod.InputsSource.APIS,
        cacheInputs: false,
      });

      const origLog = console.log;
      const origWarn = console.warn;
      try {
        console.log = () => {};
        console.warn = () => {};
        const runRes = await dsSam.runFinalOnly();
        winningTotalPmpe = Number(runRes?.winningTotalPmpe ?? 0);
        const aggregated = await dsSam.getAggregatedData();
        baseInflPmpe = Number(aggregated?.rewards?.inflationPmpe ?? 0);
        baseMevPmpe = Number(aggregated?.rewards?.mevPmpe ?? 0);
      } finally {
        console.log = origLog;
        console.warn = origWarn;
      }

      // Debug log for Marinade SDK output values.
      console.log(
        "[Marinade SDK] winningTotalPmpe:",
        winningTotalPmpe,
        "inflationPmpe:",
        baseInflPmpe,
        "mevPmpe:",
        baseMevPmpe,
      );

      // 3) Refresh the cache and apply the computed values.
      this.sdkEffBidCache = {
        ts: now,
        winningTotalPmpe,
        inflationPmpe: baseInflPmpe,
        mevPmpe: baseMevPmpe,
      };
      await this.applyEffBidToVotes(winningTotalPmpe, baseInflPmpe, baseMevPmpe);
    } catch (e) {
      console.error("updateGlobalEffectiveBid", e);
    }
  }

  // Precompute the (5,0) and (5,2) cases, then apply the appropriate one per vote account.
  private async applyEffBidToVotes(
    winningTotalPmpe: number,
    baseInflPmpe: number,
    baseMevPmpe: number,
  ): Promise<void> {
    // (5,0): commission 5%, mev_commission 0%
    const eff50 = Math.max(
      0,
      Number(winningTotalPmpe) - (baseInflPmpe * (1 - 0.05) + baseMevPmpe * (1 - 0)),
    );
    // (5,2): commission 5%, mev_commission 2%
    const eff52 = Math.max(
      0,
      Number(winningTotalPmpe) - (baseInflPmpe * (1 - 0.05) + baseMevPmpe * (1 - 0.02)),
    );

    const [, mevCommissionBpsByVote] = await Promise.all([
      this.loadValidatorsAdvertisedCommission(),
      this.loadMevCommissionBps(),
    ]);

    for (const vote of this.toUniqueList(this.votes)) {
      const mevBps = Number(mevCommissionBpsByVote[vote]);
      // Treat MEV commission below 100 bps (1%) as 0%, otherwise treat it as 2%.
      const isMev0 = Number.isFinite(mevBps) && mevBps < 100;
      const useEff = isMev0 ? eff50 : eff52;
      const commLabel = "5";
      const mevLabel = isMev0 ? "0" : "2";
      this.marinadeMinEffectiveBidGauge.labels(vote, commLabel, mevLabel).set(useEff);
    }
  }

  // Aggregate fee and tip metrics from vx.tools epoch income data.
  public async updateEpochIncomeFromVx(validators: string): Promise<void> {
    this.blockFeesTotalGauge.reset();
    this.mevFeesTotalGauge.reset();
    this.blockTipsMedianGauge.reset();

    const voteAccounts = this.toUniqueList(validators);
    const resolveFallbackEpochLabel = createSolanaEpochLabelResolver({
      rpcUrl: this.rpcUrl,
      postWithCache: this.postWithCache.bind(this),
    });
    // postWithCache already follows a cache-first strategy, so default usage is fine here.
    await Promise.all(
      voteAccounts.map(async (vote) => {
        const identity = this.validatorToIdentityMap[vote];
        if (!identity) return;
        try {
          const url = "https://api.vx.tools/epochs/income";
          const payload = { identity, limit: 1 };
          // postWithCache returns cached data immediately when available and fetches otherwise.
          const data = await this.postWithCache(
            url,
            payload,
            (response: { data: any }) => response.data,
            this.VX_CACHE_TTL_MS,
            25000,
          );
          const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
          if (!Array.isArray(rows) || rows.length === 0) {
            const fallbackEpochLabel = await resolveFallbackEpochLabel();
            emitZeroSolanaVxIncomeMetrics({
              vote,
              epochLabel: fallbackEpochLabel,
              blockFeesTotalGauge: this.blockFeesTotalGauge,
              mevFeesTotalGauge: this.mevFeesTotalGauge,
              blockTipsMedianGauge: this.blockTipsMedianGauge,
            });
            return;
          }
          const latest = rows[rows.length - 1];
          const epochLabel = String(latest?.epoch ?? "") || (await resolveFallbackEpochLabel());
          if (!epochLabel) {
            return;
          }

          const baseFeesTotal = Number(latest?.totalIncome?.baseFees ?? 0);
          const priorityFeesTotal = Number(latest?.totalIncome?.priorityFees ?? 0);
          const mevTipsTotal = Number(latest?.totalIncome?.mevTips ?? 0);

          const mevTipsMedian = Number(latest?.medianIncome?.mevTips ?? 0);

          const totalFeesSol = (baseFeesTotal + priorityFeesTotal) / LAMPORTS_PER_SOL;
          const mevFeesSol = mevTipsTotal / LAMPORTS_PER_SOL;
          const medianTipsSol = mevTipsMedian / LAMPORTS_PER_SOL;

          this.blockFeesTotalGauge.labels(vote, epochLabel).set(totalFeesSol);
          this.mevFeesTotalGauge.labels(vote, epochLabel).set(mevFeesSol);
          this.blockTipsMedianGauge.labels(vote, epochLabel).set(medianTipsSol);
        } catch (e) {
          const fallbackEpochLabel = await resolveFallbackEpochLabel();
          emitZeroSolanaVxIncomeMetrics({
            vote,
            epochLabel: fallbackEpochLabel,
            blockFeesTotalGauge: this.blockFeesTotalGauge,
            mevFeesTotalGauge: this.mevFeesTotalGauge,
            blockTipsMedianGauge: this.blockTipsMedianGauge,
          });
          console.error("updateEpochIncomeFromVx", e);
        }
      }),
    );
  }

  // vx.tools leaderboard average for the top 50 validators by stake, normalized per slot.
  public async updateEpochMedianFeesAverages(): Promise<void> {
    const resolveFallbackEpochLabel = createSolanaEpochLabelResolver({
      rpcUrl: this.rpcUrl,
      postWithCache: this.postWithCache.bind(this),
    });

    try {
      this.epochMedianBaseFeesAvgGauge.reset();
      this.epochMedianPriorityFeesAvgGauge.reset();
      this.epochMedianMevTipsAvgGauge.reset();

      const url = "https://api.vx.tools/epochs/leaderboard/income";
      const payload = {} as any;
      const rows = await this.postWithCache(
        url,
        payload,
        (response: { data: any }) => response.data,
        this.getRandomCacheDuration(5 * 60 * 1000, 60 * 1000),
        25000,
      );
      // expected shape: { epoch: number, records: [] }
      const epochFromRoot = rows && typeof rows === "object" ? rows.epoch : undefined;
      const records: any[] = Array.isArray(rows?.records)
        ? rows.records
        : Array.isArray(rows)
          ? rows
          : Array.isArray(rows?.data)
            ? rows.data
            : [];
      if (!Array.isArray(records) || records.length === 0) {
        const fallbackEpochLabel =
          String(epochFromRoot ?? "") || (await resolveFallbackEpochLabel());
        emitZeroSolanaVxMedianAverages({
          epochLabel: fallbackEpochLabel,
          epochMedianBaseFeesAvgGauge: this.epochMedianBaseFeesAvgGauge,
          epochMedianPriorityFeesAvgGauge: this.epochMedianPriorityFeesAvgGauge,
          epochMedianMevTipsAvgGauge: this.epochMedianMevTipsAvgGauge,
        });
        return;
      }

      // Sort by stake and keep only the top 50 validators.
      const sorted = [...records].sort((a, b) => Number(b?.stake ?? 0) - Number(a?.stake ?? 0));
      const top = sorted.slice(0, 50);
      const epochLabel =
        String(epochFromRoot ?? top[0]?.epoch ?? "") || (await resolveFallbackEpochLabel());
      if (!epochLabel) return;

      const totalBaseLamports = top.reduce(
        (acc, it) => acc + Number(it?.totalIncome?.baseFees ?? 0),
        0,
      );
      const totalPriorityLamports = top.reduce(
        (acc, it) => acc + Number(it?.totalIncome?.priorityFees ?? 0),
        0,
      );
      const totalMevLamports = top.reduce(
        (acc, it) => acc + Number(it?.totalIncome?.mevTips ?? 0),
        0,
      );
      const totalConfirmedSlots = top.reduce((acc, it) => acc + Number(it?.confirmedSlots ?? 0), 0);

      if (!Number.isFinite(totalConfirmedSlots) || totalConfirmedSlots <= 0) {
        emitZeroSolanaVxMedianAverages({
          epochLabel,
          epochMedianBaseFeesAvgGauge: this.epochMedianBaseFeesAvgGauge,
          epochMedianPriorityFeesAvgGauge: this.epochMedianPriorityFeesAvgGauge,
          epochMedianMevTipsAvgGauge: this.epochMedianMevTipsAvgGauge,
        });
        return;
      }

      const baseAvg = totalBaseLamports / totalConfirmedSlots / LAMPORTS_PER_SOL;
      const priorityAvg = totalPriorityLamports / totalConfirmedSlots / LAMPORTS_PER_SOL;
      const mevAvg = totalMevLamports / totalConfirmedSlots / LAMPORTS_PER_SOL;

      this.epochMedianBaseFeesAvgGauge.labels(epochLabel).set(baseAvg);
      this.epochMedianPriorityFeesAvgGauge.labels(epochLabel).set(priorityAvg);
      this.epochMedianMevTipsAvgGauge.labels(epochLabel).set(mevAvg);
    } catch (e) {
      const fallbackEpochLabel = await resolveFallbackEpochLabel();
      emitZeroSolanaVxMedianAverages({
        epochLabel: fallbackEpochLabel,
        epochMedianBaseFeesAvgGauge: this.epochMedianBaseFeesAvgGauge,
        epochMedianPriorityFeesAvgGauge: this.epochMedianPriorityFeesAvgGauge,
        epochMedianMevTipsAvgGauge: this.epochMedianMevTipsAvgGauge,
      });
      console.error("updateEpochMedianFeesAverages", e);
    }
  }

  // JPool pending stake: activation/deactivation by source aggregated in SOL
  private async updatePendingStakeFromJPool(validators: string): Promise<void> {
    this.pendingActivationBySourceGauge.reset();
    this.pendingDeactivationBySourceGauge.reset();
    const voteAccounts = this.toUniqueList(validators);
    await Promise.all(
      voteAccounts.map(async (vote) => {
        try {
          const url = `https://api.jpool.one/validators/${vote}/pending-stake`;
          const data = await this.getWithCache(
            url,
            (response: { data: any }) => response.data,
            this.getRandomCacheDuration(60000, 15000),
            10000,
          );
          const accounts: any[] = Array.isArray(data?.stake_accounts) ? data.stake_accounts : [];
          if (accounts.length === 0) return;

          const activationBySource: Record<string, number> = {};
          const deactivationBySource: Record<string, number> = {};

          for (const it of accounts) {
            const source = String(it?.stake_type || "unknown") || "unknown";
            const lamports = Number(it?.delegated_amount ?? 0);
            const type = String(it?.type || "").toLowerCase();
            if (type === "activation") {
              activationBySource[source] = (activationBySource[source] || 0) + lamports;
            } else if (type === "deactivation") {
              deactivationBySource[source] = (deactivationBySource[source] || 0) + lamports;
            }
          }

          for (const source of Object.keys(activationBySource)) {
            const lamports = activationBySource[source];
            this.pendingActivationBySourceGauge
              .labels(vote, source)
              .set(lamports / LAMPORTS_PER_SOL);
          }
          for (const source of Object.keys(deactivationBySource)) {
            const lamports = deactivationBySource[source];
            this.pendingDeactivationBySourceGauge
              .labels(vote, source)
              .set(lamports / LAMPORTS_PER_SOL);
          }
        } catch (e) {
          console.error("updatePendingStakeFromJPool", e);
        }
      }),
    );
  }
}
