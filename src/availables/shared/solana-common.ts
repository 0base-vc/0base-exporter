type GaugeWithAddressLabel = {
  reset(): void;
  labels(...labels: string[]): { set(value: number): void };
};

type GaugeWithSingleSet = {
  reset(): void;
  labels(...labels: string[]): { set(value: number): void };
};

type PostFn = (
  url: string,
  data: { method: string; params?: unknown[] },
  selector: (response: { data: any }) => any,
) => Promise<any>;

type PostWithCacheFn = (
  url: string,
  data: unknown,
  selector: (response: { data: any }) => any,
  cacheDurationMs?: number,
  timeoutMs?: number,
) => Promise<any>;

type PostImmutableWithLRUFn = (
  url: string,
  data: unknown,
  selector: (response: { data: any }) => any,
  maxEntries?: number,
  isCacheable?: (result: any) => boolean,
) => Promise<any>;

type GetWithCacheFn = (
  url: string,
  selector: (response: { data: any }) => any,
  cacheDurationMs?: number,
  timeoutMs?: number,
) => Promise<any>;

const LAMPORTS_PER_SOL = 1e9;

export function toUniqueCsv(csv: string): string[] {
  return Array.from(
    new Set(
      csv
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export async function getSolanaAmount(params: {
  url: string;
  data: { method: string; params?: unknown[] };
  selector: (json: any) => number;
  postWithCache: PostWithCacheFn;
}): Promise<number> {
  return params.postWithCache(params.url, params.data, (response) => {
    return params.selector(response.data) / LAMPORTS_PER_SOL;
  });
}

export async function getSolanaCurrentEpochLabel(params: {
  rpcUrl: string;
  postWithCache: PostWithCacheFn;
  cacheDurationMs?: number;
  timeoutMs?: number;
}): Promise<string> {
  const epoch = await params.postWithCache(
    params.rpcUrl,
    { method: "getEpochInfo", params: [{ commitment: "processed" }] },
    (response) => response.data?.result?.epoch,
    params.cacheDurationMs ?? 60000,
    params.timeoutMs ?? 10000,
  );

  const epochNumber = Number(epoch);
  return Number.isFinite(epochNumber) ? String(epochNumber) : "";
}

export function createSolanaEpochLabelResolver(params: {
  rpcUrl: string;
  postWithCache: PostWithCacheFn;
  cacheDurationMs?: number;
  timeoutMs?: number;
}): () => Promise<string> {
  let pending: Promise<string> | null = null;

  return async () => {
    if (!pending) {
      pending = getSolanaCurrentEpochLabel(params);
    }

    return pending;
  };
}

export async function updateSolanaBlockProduction(params: {
  validators: string;
  validatorToIdentityMap: Record<string, string>;
  rpcUrl: string;
  slotsAssignedGauge: GaugeWithSingleSet;
  slotsProducedGauge: GaugeWithSingleSet;
  slotsSkippedGauge: GaugeWithSingleSet;
  postWithCache: PostWithCacheFn;
  cacheDurationMs?: number;
  timeoutMs?: number;
}): Promise<void> {
  params.slotsAssignedGauge.reset();
  params.slotsProducedGauge.reset();
  params.slotsSkippedGauge.reset();

  const voteAccounts = toUniqueCsv(params.validators);
  if (voteAccounts.length === 0) {
    return;
  }

  const resolveEpochLabel = createSolanaEpochLabelResolver({
    rpcUrl: params.rpcUrl,
    postWithCache: params.postWithCache,
    cacheDurationMs: params.cacheDurationMs,
    timeoutMs: params.timeoutMs,
  });

  const byIdentity = await params.postWithCache(
    params.rpcUrl,
    { method: "getBlockProduction", params: [{ commitment: "finalized" }] },
    (response) => response.data?.result?.value?.byIdentity,
    params.cacheDurationMs ?? 60000,
    params.timeoutMs ?? 10000,
  );

  const epochLabel = await resolveEpochLabel();
  if (!epochLabel) {
    return;
  }

  const productionMap =
    byIdentity && typeof byIdentity === "object" ? (byIdentity as Record<string, unknown>) : {};

  for (const vote of voteAccounts) {
    const identity = params.validatorToIdentityMap[vote];
    if (!identity) {
      continue;
    }

    const counts = Array.isArray(productionMap[identity]) ? productionMap[identity] : [];
    const totalSlots = Number(counts[0] ?? 0);
    const producedSlots = Number(counts[1] ?? 0);
    const skippedSlots =
      Number.isFinite(totalSlots) && Number.isFinite(producedSlots)
        ? Math.max(totalSlots - producedSlots, 0)
        : 0;

    params.slotsAssignedGauge
      .labels(vote, epochLabel)
      .set(Number.isFinite(totalSlots) ? totalSlots : 0);
    params.slotsProducedGauge
      .labels(vote, epochLabel)
      .set(Number.isFinite(producedSlots) ? producedSlots : 0);
    params.slotsSkippedGauge.labels(vote, epochLabel).set(skippedSlots);
  }
}

export function emitZeroSolanaVxIncomeMetrics(params: {
  vote: string;
  epochLabel: string;
  blockFeesTotalGauge: GaugeWithSingleSet;
  mevFeesTotalGauge: GaugeWithSingleSet;
  blockTipsMedianGauge: GaugeWithSingleSet;
}): void {
  if (!params.epochLabel) {
    return;
  }

  params.blockFeesTotalGauge.labels(params.vote, params.epochLabel).set(0);
  params.mevFeesTotalGauge.labels(params.vote, params.epochLabel).set(0);
  params.blockTipsMedianGauge.labels(params.vote, params.epochLabel).set(0);
}

export function emitZeroSolanaVxMedianAverages(params: {
  epochLabel: string;
  epochMedianBaseFeesAvgGauge: GaugeWithSingleSet;
  epochMedianPriorityFeesAvgGauge: GaugeWithSingleSet;
  epochMedianMevTipsAvgGauge: GaugeWithSingleSet;
}): void {
  if (!params.epochLabel) {
    return;
  }

  params.epochMedianBaseFeesAvgGauge.labels(params.epochLabel).set(0);
  params.epochMedianPriorityFeesAvgGauge.labels(params.epochLabel).set(0);
  params.epochMedianMevTipsAvgGauge.labels(params.epochLabel).set(0);
}

export async function updateSolanaBalances(params: {
  addresses: string;
  rpcUrl: string;
  availableGauge: GaugeWithAddressLabel;
  balanceGauge: GaugeWithAddressLabel;
  postWithCache: PostWithCacheFn;
}): Promise<void> {
  params.availableGauge.reset();
  params.balanceGauge.reset();

  await Promise.all(
    toUniqueCsv(params.addresses).map(async (address) => {
      const available = await getSolanaAmount({
        url: params.rpcUrl,
        data: { method: "getBalance", params: [address] },
        selector: (json: any) => json.result.value,
        postWithCache: params.postWithCache,
      });

      params.availableGauge.labels(address).set(available);
      params.balanceGauge.labels(address).set(available);
    }),
  );
}

export async function updateSolanaVoteAccounts(params: {
  validators: string;
  rpcUrl: string;
  activatedStakeGauge: GaugeWithSingleSet;
  activeGauge: GaugeWithSingleSet;
  commissionGauge: GaugeWithSingleSet;
  lastVoteGauge: GaugeWithSingleSet;
  postWithCache: PostWithCacheFn;
  onNodePubkey?: (vote: string, nodePubkey: string) => void;
}): Promise<void> {
  params.activatedStakeGauge.reset();
  params.activeGauge.reset();
  params.commissionGauge.reset();
  params.lastVoteGauge.reset();

  const voteAccounts = toUniqueCsv(params.validators);
  const allValidators = await params.postWithCache(
    params.rpcUrl,
    { method: "getVoteAccounts" },
    (response) => {
      const current = Array.isArray(response.data?.result?.current)
        ? response.data.result.current
        : [];
      const delinquent = Array.isArray(response.data?.result?.delinquent)
        ? response.data.result.delinquent
        : [];

      return [
        ...current.map((item: any) => ({ ...item, status: "current" as const })),
        ...delinquent.map((item: any) => ({ ...item, status: "delinquent" as const })),
      ];
    },
  );

  const validators = Array.isArray(allValidators) ? allValidators : [];
  for (const vote of voteAccounts) {
    const validator = validators.find(
      (item: any) => item && typeof item === "object" && item.votePubkey === vote,
    );
    if (!validator) continue;

    params.activatedStakeGauge.labels(vote).set(validator.activatedStake / LAMPORTS_PER_SOL);
    params.activeGauge.labels(vote).set(validator.status === "current" ? 1 : 0);
    params.commissionGauge.labels(vote).set(validator.commission);
    params.lastVoteGauge.labels(vote).set(validator.lastVote);

    if (validator.nodePubkey && params.onNodePubkey) {
      params.onNodePubkey(vote, validator.nodePubkey);
    }
  }
}

export async function updateSolanaClusterRequiredVersions(params: {
  cluster: "mainnet-beta" | "testnet";
  clusterRequiredVersionGauge: GaugeWithSingleSet;
  getWithCache: GetWithCacheFn;
}): Promise<void> {
  try {
    params.clusterRequiredVersionGauge.reset();

    const url = `https://api.solana.org/api/community/v1/sfdp_required_versions?cluster=${params.cluster}`;
    const data = await params.getWithCache(url, (response) => response.data, 60000);
    const items: any[] = Array.isArray(data?.data) ? data.data : [];
    if (items.length === 0) return;

    const latest = items[items.length - 1];
    const epoch = Number(latest?.epoch ?? NaN);
    if (!Number.isFinite(epoch)) return;

    params.clusterRequiredVersionGauge
      .labels(String(latest?.agave_min_version ?? ""), String(latest?.firedancer_min_version ?? ""))
      .set(epoch);
  } catch (error) {
    console.error("updateClusterRequiredVersions", error);
  }
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  iteratee: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < values.length) {
      const currentIndex = index++;
      results[currentIndex] = await iteratee(values[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function updateSolanaLeaderWindowsAndEpochEnd(params: {
  identities: string;
  rpcUrl: string;
  performanceRpcUrl: string;
  leaderSlotNextTsGauge: GaugeWithSingleSet;
  leaderSlotRewardTsGauge: GaugeWithSingleSet;
  epochEndTsGauge: GaugeWithSingleSet;
  epochStateGauge: GaugeWithSingleSet;
  post: PostFn;
  postWithCache: PostWithCacheFn;
  postImmutableWithLRU: PostImmutableWithLRUFn;
}): Promise<void> {
  try {
    params.leaderSlotNextTsGauge.reset();
    params.leaderSlotRewardTsGauge.reset();
    params.epochEndTsGauge.reset();

    const epochInfo = await params.post(
      params.rpcUrl,
      { method: "getEpochInfo", params: [{ commitment: "processed" }] },
      (response) => response.data?.result,
    );
    const epoch = Number(epochInfo?.epoch ?? NaN);
    const absoluteSlot = Number(epochInfo?.absoluteSlot ?? NaN);
    const slotIndex = Number(epochInfo?.slotIndex ?? NaN);
    const slotsInEpoch = Number(epochInfo?.slotsInEpoch ?? NaN);
    if (
      !Number.isFinite(epoch) ||
      !Number.isFinite(absoluteSlot) ||
      !Number.isFinite(slotIndex) ||
      !Number.isFinite(slotsInEpoch)
    ) {
      return;
    }

    const epochFirstSlot = absoluteSlot - slotIndex;
    const samples = await params.postWithCache(
      params.performanceRpcUrl,
      { method: "getRecentPerformanceSamples", params: [15] },
      (response) => response.data?.result,
      120000,
    );

    const performanceSamples: any[] = Array.isArray(samples) ? samples : [];
    let totalSlots = 0;
    let totalSecs = 0;

    for (const sample of performanceSamples) {
      const numSlots = Number(sample?.numSlots ?? 0);
      const sampleSecs = Number(sample?.samplePeriodSecs ?? 0);
      if (
        Number.isFinite(numSlots) &&
        Number.isFinite(sampleSecs) &&
        numSlots > 0 &&
        sampleSecs > 0
      ) {
        totalSlots += numSlots;
        totalSecs += sampleSecs;
      }
    }

    if (!(totalSlots > 0 && totalSecs > 0)) {
      return;
    }

    const secondsPerSlot = totalSecs / totalSlots;
    const nowSec = Date.now() / 1000;
    const epochEndAbsSlot = epochFirstSlot + slotsInEpoch - 1;
    const deltaToEnd = Math.max(0, epochEndAbsSlot - absoluteSlot);

    params.epochEndTsGauge
      .labels(String(epoch))
      .set(Math.floor(nowSec + deltaToEnd * secondsPerSlot));
    params.epochStateGauge.reset();
    params.epochStateGauge.labels("current", String(epoch)).set(1);
    if (epoch > 0) {
      params.epochStateGauge.labels("prev", String(epoch - 1)).set(1);
    }

    await Promise.all(
      toUniqueCsv(params.identities).map(async (identity) => {
        try {
          const schedule = await params.postWithCache(
            params.rpcUrl,
            { method: "getLeaderSchedule", params: [null, { identity }] },
            (response) => response.data?.result,
            60000,
          );

          if (!schedule || typeof schedule !== "object") return;

          const slotsRel: number[] = Array.isArray(schedule[identity]) ? schedule[identity] : [];
          if (slotsRel.length === 0) return;

          const futureWindowStarts = Array.from(
            new Set(
              slotsRel
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value >= slotIndex)
                .map((value) => Math.floor(value / 4) * 4),
            ),
          )
            .sort((left, right) => left - right)
            .slice(0, 5);

          const pastWindowStarts = Array.from(
            new Set(
              slotsRel
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value < slotIndex)
                .map((value) => Math.floor(value / 4) * 4),
            ),
          ).sort((left, right) => left - right);

          for (const startRel of futureWindowStarts) {
            const absoluteLeaderSlot = epochFirstSlot + startRel;
            const timestamp = Math.floor(
              nowSec + (absoluteLeaderSlot - absoluteSlot) * secondsPerSlot,
            );
            params.leaderSlotNextTsGauge
              .labels(identity, String(epoch), String(absoluteLeaderSlot))
              .set(timestamp);
          }

          const recentPastWindows = pastWindowStarts.slice(
            Math.max(0, pastWindowStarts.length - 3),
          );
          await mapWithConcurrency(recentPastWindows, 2, async (startRel) => {
            try {
              const absStart = epochFirstSlot + startRel;
              const slots = [absStart, absStart + 1, absStart + 2, absStart + 3];
              const blocks = await Promise.all(
                slots.map((slot) =>
                  params.postImmutableWithLRU(
                    params.rpcUrl,
                    {
                      method: "getBlock",
                      params: [
                        slot,
                        { encoding: "json", transactionDetails: "none", rewards: true },
                      ],
                    },
                    (response) => response.data?.result,
                    undefined,
                    (result) => result && Array.isArray(result.rewards),
                  ),
                ),
              );

              const validBlocks = blocks.filter((block) => block && Array.isArray(block.rewards));
              if (validBlocks.length === 0) return;

              let lamports = 0;
              for (const block of validBlocks) {
                for (const reward of block.rewards as any[]) {
                  if (String(reward?.rewardType || reward?.reward_type) === "Fee") {
                    lamports += Number(reward?.lamports ?? 0);
                  }
                }
              }

              const rewardsSol = lamports / LAMPORTS_PER_SOL;
              const timestamp = Math.floor(nowSec + (absStart - absoluteSlot) * secondsPerSlot);
              params.leaderSlotRewardTsGauge
                .labels(identity, String(epoch), String(absStart), String(rewardsSol))
                .set(timestamp);
            } catch (innerError) {
              console.error("leaderSlotTsGauge rewards calc error", identity, startRel, innerError);
            }
          });
        } catch (error) {
          console.error("updateUpcomingLeaderSlots identity", identity, error);
        }
      }),
    );
  } catch (error) {
    console.error("updateUpcomingLeaderSlots", error);
  }
}
