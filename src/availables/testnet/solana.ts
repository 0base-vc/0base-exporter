// ENV VALIDATOR = Vote key
// ENV ADDRESS = Identity key

import TargetAbstract from "../../target.abstract";
import { Gauge, Registry } from "prom-client";
import * as _ from "lodash";
import {
  updateSolanaBalances,
  updateSolanaClusterRequiredVersions,
  updateSolanaLeaderWindowsAndEpochEnd,
  updateSolanaVoteAccounts,
} from "../shared/solana-common";

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

  private readonly onboardingPriorityGauge = new Gauge({
    name: `${this.metricPrefix}_onboarding_priority`,
    help: "Validator onboarding priority number",
    labelNames: ["identity"],
  });

  private readonly clusterRequiredVersionGauge = new Gauge({
    name: `${this.metricPrefix}_cluster_required_versions`,
    help: "Cluster required client versions (Agave/Frankendancer) labeled as strings; value equals epoch",
    labelNames: ["min_version_agave", "min_version_frankendancer"],
  });

  private readonly validatorReleaseVersionGauge = new Gauge({
    name: `${this.metricPrefix}_validator_release_version`,
    help: "Validator release client version labeled as string; value fixed to 1",
    labelNames: ["identity", "release_version"],
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

  private readonly tvcEarnedDeltaGauge = new Gauge({
    name: `${this.metricPrefix}_validator_tvc_earned_delta`,
    help: "Earned vote credits delta in finalized window since last scrape",
    labelNames: ["vote"],
  });

  private readonly tvcMissedDeltaGauge = new Gauge({
    name: `${this.metricPrefix}_validator_tvc_missed_delta`,
    help: "Missed vote credits (expected - earned) in finalized window since last scrape",
    labelNames: ["vote"],
  });

  // private readonly validatorsCount = new Gauge({
  //     name: `${this.metricPrefix}_validators_count`,
  //     help: 'Validators count',
  // });

  // Track onboarding-priority fetch eligibility to reduce repeated failed lookups.
  private readonly onboardingFailedValidators: Set<string> = new Set();
  private readonly onboardingAllowedValidators: Set<string> = new Set();
  private onboardingSelectionLocked: boolean = false;

  private get rpcApiUrl(): string {
    return this.apiUrl || this.rpcUrl;
  }

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
    this.registry.registerMetric(this.lastVoteGauge);
    this.registry.registerMetric(this.onboardingPriorityGauge);
    this.registry.registerMetric(this.clusterRequiredVersionGauge);
    this.registry.registerMetric(this.validatorReleaseVersionGauge);
    this.registry.registerMetric(this.tvcEarnedDeltaGauge);
    this.registry.registerMetric(this.tvcMissedDeltaGauge);
    this.registry.registerMetric(this.leaderSlotNextTsGauge);
    this.registry.registerMetric(this.leaderSlotRewardTsGauge);
    this.registry.registerMetric(this.epochEndTsGauge);
    this.registry.registerMetric(this.epochStateGauge);
  }

  public async makeMetrics(): Promise<string> {
    let customMetrics = "";
    try {
      await Promise.all([
        this.updateBalance(
          [this.votes, this.identities, this.walletAddresses].filter(Boolean).join(","),
        ),
        this.updateVoteAccounts(this.votes),
        this.updateOnboardingPriority(this.identities),
        this.updateClusterRequiredVersions(),
        this.updateValidatorReleaseVersions(),
        this.updateTvcDeltas(this.votes),
        this.updateLeaderWindowsAndEpochEnd(),
      ]);

      customMetrics = await this.registry.metrics();
    } catch (e) {
      console.error("makeMetrics", e);
    }

    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  // merged into updateLeaderWindowsAndEpochEnd

  private async updateLeaderWindowsAndEpochEnd(): Promise<void> {
    await updateSolanaLeaderWindowsAndEpochEnd({
      identities: this.identities,
      rpcUrl: this.rpcUrl,
      performanceRpcUrl: "https://api.testnet.solana.com",
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
      rpcUrl: this.rpcApiUrl,
      availableGauge: this.availableGauge,
      balanceGauge: this.balanceGauge,
      postWithCache: this.postWithCache.bind(this),
    });
  }

  private async updateVoteAccounts(validators: string): Promise<void> {
    await updateSolanaVoteAccounts({
      validators,
      rpcUrl: this.rpcApiUrl,
      activatedStakeGauge: this.activatedStakeGauge,
      activeGauge: this.activeGauge,
      commissionGauge: this.commissionGauge,
      lastVoteGauge: this.lastVoteGauge,
      post: this.post.bind(this),
    });
  }

  private async updateOnboardingPriority(identities: string): Promise<void> {
    this.onboardingPriorityGauge.reset();
    const identityAccounts = this.toUniqueList(identities);

    // Before the first pass, keep track of success and failure per identity.
    // After the first pass, only continue polling identities that succeeded once.
    const targets: string[] = this.onboardingSelectionLocked
      ? identityAccounts.filter((v) => this.onboardingAllowedValidators.has(v))
      : identityAccounts.filter((v) => !this.onboardingFailedValidators.has(v));

    await Promise.all(
      targets.map(async (identity) => {
        try {
          const onboardingData = await this.getWithCache(
            `https://api.solana.org/api/validators/${identity}?cacheStatus=enable`,
            (response: { data: any }) => response.data,
          );

          const hasValue =
            onboardingData &&
            onboardingData.onboardingNumber !== null &&
            onboardingData.onboardingNumber !== undefined;
          if (hasValue) {
            this.onboardingPriorityGauge.labels(identity).set(onboardingData.onboardingNumber);
            if (!this.onboardingSelectionLocked) {
              this.onboardingAllowedValidators.add(identity);
            }
          } else if (!this.onboardingSelectionLocked) {
            this.onboardingFailedValidators.add(identity);
          }
        } catch (e) {
          if (!this.onboardingSelectionLocked) {
            this.onboardingFailedValidators.add(identity);
          }
          console.error(`Failed to get onboarding priority for identity ${identity}:`, e);
        }
      }),
    );

    // Lock the selection after the first pass so only successful identities keep being checked.
    if (!this.onboardingSelectionLocked) {
      this.onboardingSelectionLocked = true;
    }
  }

  private async updateClusterRequiredVersions(): Promise<void> {
    await updateSolanaClusterRequiredVersions({
      cluster: "testnet",
      clusterRequiredVersionGauge: this.clusterRequiredVersionGauge,
      getWithCache: this.getWithCache.bind(this),
    });
  }

  private async getCurrentEpochNumber(): Promise<number | null> {
    try {
      const epoch = await this.postWithCache(
        this.rpcApiUrl,
        { method: "getEpochInfo" },
        (response) => {
          return Number(response.data?.result?.epoch ?? NaN);
        },
      );
      return Number.isFinite(epoch) ? epoch : null;
    } catch (e) {
      console.error("getCurrentEpochNumber", e);
      return null;
    }
  }

  private async updateValidatorReleaseVersions(): Promise<void> {
    try {
      this.validatorReleaseVersionGauge.reset();
      const epoch = await this.getCurrentEpochNumber();
      if (epoch == null) return;
      const targetEpoch = epoch - 1;
      if (targetEpoch < 0) return;
      const identityAccounts = this.toUniqueList(this.identities);
      await Promise.all(
        identityAccounts.map(async (identity) => {
          try {
            const url = `https://api.solana.org/api/validators/details?pk=${encodeURIComponent(identity)}&epoch=${encodeURIComponent(String(targetEpoch))}`;
            const data = await this.getWithCache(
              url,
              (response: { data: any }) => response.data,
              60000,
            );
            const releaseVersion: string = String(data?.stats?.release_version ?? "");
            if (releaseVersion) {
              this.validatorReleaseVersionGauge.labels(identity, releaseVersion).set(1);
            }
          } catch (inner) {
            console.error(`updateValidatorReleaseVersions ${identity}`, inner);
          }
        }),
      );
    } catch (e) {
      console.error("updateValidatorReleaseVersions", e);
    }
  }

  // ---------------------- TVC deltas (earned/missed) ----------------------
  private readonly tvcStateByVote: Map<
    string,
    { epoch: number; finalizedSlot: number; earnedNow: number }
  > = new Map();

  private async updateTvcDeltas(validators: string): Promise<void> {
    try {
      this.tvcEarnedDeltaGauge.reset();
      this.tvcMissedDeltaGauge.reset();

      // Fetch finalized epoch info and slot with short cache to keep deltas responsive
      const epoch: number = await this.post(
        this.rpcUrl,
        { method: "getEpochInfo", params: [{ commitment: "finalized" }] } as any,
        (response) => {
          return Number(response.data?.result?.epoch ?? NaN);
        },
      );
      if (!Number.isFinite(epoch)) return;

      const finalizedSlot: number = await this.post(
        this.rpcUrl,
        { method: "getSlot", params: [{ commitment: "finalized" }] } as any,
        (response) => {
          return Number(response.data?.result ?? NaN);
        },
      );
      if (!Number.isFinite(finalizedSlot)) return;

      // Get all vote accounts at finalized commitment
      const voteAccountsResponse = await this.post(
        this.rpcUrl,
        { method: "getVoteAccounts", params: [{ commitment: "finalized" }] } as any,
        (response) => response.data,
      );
      const currentList: any[] = Array.isArray(voteAccountsResponse?.result?.current)
        ? voteAccountsResponse.result.current
        : [];
      const delinquentList: any[] = Array.isArray(voteAccountsResponse?.result?.delinquent)
        ? voteAccountsResponse.result.delinquent
        : [];
      const allValidators: any[] = _.concat(
        currentList.map((i: any) => {
          i.status = "current";
          return i;
        }),
        delinquentList.map((i: any) => {
          i.status = "delinquent";
          return i;
        }),
      );

      for (const vote of this.toUniqueList(validators)) {
        const me: any = _.find(allValidators, (o: any) => o.votePubkey === vote);
        if (!me) continue;

        const epochCredits =
          Array.isArray(me.epochCredits) && me.epochCredits.length > 0
            ? me.epochCredits[me.epochCredits.length - 1]
            : null;
        if (!epochCredits) continue;

        const curEpoch: number = Number(epochCredits[0] ?? NaN);
        const credits: number = Number(epochCredits[1] ?? 0);
        const prevCredits: number = Number(epochCredits[2] ?? 0);
        let earnedNow: number = credits - prevCredits;
        if (!Number.isFinite(earnedNow) || earnedNow < 0) earnedNow = 0;

        const prevState = this.tvcStateByVote.get(vote);
        // Initialize state on first run or epoch change or mismatch
        if (!prevState || prevState.epoch !== epoch || curEpoch !== epoch) {
          this.tvcStateByVote.set(vote, {
            epoch: epoch,
            finalizedSlot: finalizedSlot,
            earnedNow: earnedNow,
          });
          continue;
        }

        let deltaSlots = finalizedSlot - prevState.finalizedSlot;
        if (!Number.isFinite(deltaSlots) || deltaSlots < 0) deltaSlots = 0;
        const expectedDelta = deltaSlots * 16; // expected credits per slot window
        let deltaEarned = earnedNow - prevState.earnedNow;
        if (!Number.isFinite(deltaEarned) || deltaEarned < 0) deltaEarned = 0;
        let missedDelta = expectedDelta - deltaEarned;
        if (!Number.isFinite(missedDelta) || missedDelta < 0) missedDelta = 0;

        this.tvcEarnedDeltaGauge.labels(vote).set(deltaEarned);
        this.tvcMissedDeltaGauge.labels(vote).set(missedDelta);

        // Update state
        this.tvcStateByVote.set(vote, {
          epoch: epoch,
          finalizedSlot: finalizedSlot,
          earnedNow: earnedNow,
        });
      }
    } catch (e) {
      console.error("updateTvcDeltas", e);
    }
  }
}
