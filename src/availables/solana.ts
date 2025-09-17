import TargetAbstract from "../target.abstract";
import { Gauge, Registry } from 'prom-client';
import * as _ from 'lodash';
// axios 제거: TargetAbstract의 getWithCache/postWithCache 사용

const LAMPORTS_PER_SOL = 1e9;

export default class Solana extends TargetAbstract {


    private readonly metricPrefix = 'solana';

    private readonly registry = new Registry();

    private readonly balanceGauge = new Gauge({
        name: `${this.metricPrefix}_address_balance`,
        help: 'Total balance of address',
        labelNames: ['address']
    });

    private readonly availableGauge = new Gauge({
        name: `${this.metricPrefix}_address_available`,
        help: 'Available balance of address',
        labelNames: ['address']
    });

    private readonly activatedStakeGauge = new Gauge({
        name: `${this.metricPrefix}_validator_activated_stake`,
        help: 'Your activated stake',
        labelNames: ['vote']
    });

    private readonly activeGauge = new Gauge({
        name: `${this.metricPrefix}_validator_active`,
        help: 'Your validator active',
        labelNames: ['vote']
    });

    private readonly commissionGauge = new Gauge({
        name: `${this.metricPrefix}_validator_commission`,
        help: 'Your validator commission',
        labelNames: ['vote']
    });

    private readonly validatorBondsGauge = new Gauge({
        name: `${this.metricPrefix}_validator_bonds`,
        help: 'Your validator bonds',
        labelNames: ['vote']
    });

    private readonly delegationBySourceGauge = new Gauge({
        name: `${this.metricPrefix}_delegation_sol`,
        help: 'Delegations to validator by source',
        labelNames: ['vote', 'source']
    });

    private readonly pendingActivationBySourceGauge = new Gauge({
        name: `${this.metricPrefix}_pending_activation_sol`,
        help: 'Pending activation stake by source',
        labelNames: ['vote', 'source']
    });

    private readonly pendingDeactivationBySourceGauge = new Gauge({
        name: `${this.metricPrefix}_pending_deactivation_sol`,
        help: 'Pending deactivation stake by source',
        labelNames: ['vote', 'source']
    });

    private readonly marinadeMinEffectiveBidGauge = new Gauge({
        name: `${this.metricPrefix}_marinade_min_effective_bid_sol`,
        help: 'Minimum effective bid required to receive delegation from Marinade (pmpe)',
        labelNames: ['vote', 'commission', 'mev_commission']
    });

    private readonly marinadeMyBidGauge = new Gauge({
        name: `${this.metricPrefix}_marinade_my_bid_sol`,
        help: 'Current bid value our validator has set in Marinade',
        labelNames: ['vote']
    });

    private readonly marinadeMaxStakeWantedGauge = new Gauge({
        name: `${this.metricPrefix}_marinade_max_stake_wanted_sol`,
        help: 'Maximum stake wanted by validator in Marinade',
        labelNames: ['vote']
    });

    private readonly slotsAssignedGauge = new Gauge({
        name: `${this.metricPrefix}_slots_assigned_total`,
        help: 'Total number of leader slots assigned to our validator in the current epoch',
        labelNames: ['vote', 'epoch']
    });

    private readonly slotsProducedGauge = new Gauge({
        name: `${this.metricPrefix}_slots_produced_total`,
        help: 'Number of leader slots we successfully produced in the current epoch',
        labelNames: ['vote', 'epoch']
    });

    private readonly slotsSkippedGauge = new Gauge({
        name: `${this.metricPrefix}_slots_skipped_total`,
        help: 'Number of leader slots assigned but not produced in the current epoch',
        labelNames: ['vote', 'epoch']
    });

    private readonly blockFeesTotalGauge = new Gauge({
        name: `${this.metricPrefix}_block_fees_total_sol`,
        help: 'Total transaction fees from blocks we produced',
        labelNames: ['vote', 'epoch']
    });

    private readonly mevFeesTotalGauge = new Gauge({
        name: `${this.metricPrefix}_mev_fees_total_sol`,
        help: 'Total MEV-related fees collected',
        labelNames: ['vote', 'epoch']
    });

    private readonly blockFeesMedianGauge = new Gauge({
        name: `${this.metricPrefix}_block_fees_median_sol`,
        help: 'Median transaction fees per produced block',
        labelNames: ['vote', 'epoch']
    });

    private readonly blockTipsMedianGauge = new Gauge({
        name: `${this.metricPrefix}_block_tips_median_sol`,
        help: 'Median block tips per produced block',
        labelNames: ['vote', 'epoch']
    });

    // Epoch-level average of median incomes for top 50 by stake (vx.tools leaderboard)
    private readonly epochMedianBaseFeesAvgGauge = new Gauge({
        name: `${this.metricPrefix}_epoch_median_base_fees_avg_sol`,
        help: 'Average of median base fees among top 50 validators by stake for the epoch',
        labelNames: ['epoch']
    });
    private readonly epochMedianPriorityFeesAvgGauge = new Gauge({
        name: `${this.metricPrefix}_epoch_median_priority_fees_avg_sol`,
        help: 'Average of median priority fees among top 50 validators by stake for the epoch',
        labelNames: ['epoch']
    });
    private readonly epochMedianMevTipsAvgGauge = new Gauge({
        name: `${this.metricPrefix}_epoch_median_mev_tips_avg_sol`,
        help: 'Average of median MEV tips among top 50 validators by stake for the epoch',
        labelNames: ['epoch']
    });

    private readonly clusterRequiredVersionGauge = new Gauge({
        name: `${this.metricPrefix}_cluster_required_versions`,
        help: 'Cluster required client versions (Agave/Frankendancer) labeled as strings; value equals epoch',
        labelNames: ['min_version_agave', 'min_version_frankendancer']
    });

    private readonly validatorReleaseVersionGauge = new Gauge({
        name: `${this.metricPrefix}_validator_release_version`,
        help: 'Validator release client version labeled as string; value fixed to 1',
        labelNames: ['vote', 'release_version']
    });

    private readonly leaderSlotTsGauge = new Gauge({
        name: `${this.metricPrefix}_leader_slot_timestamp`,
        help: 'Estimated timestamp (unix seconds) for first slot of each 4-slot leader window; rewards label shows 4-slot rewards in SOL when available',
        labelNames: ['identity', 'epoch', 'slot', 'rewards']
    });

    private readonly epochEndTsGauge = new Gauge({
        name: `${this.metricPrefix}_epoch_end_timestamp`,
        help: 'Estimated unix seconds when current epoch ends',
        labelNames: ['epoch']
    });

    private readonly epochStartTsGauge = new Gauge({
        name: `${this.metricPrefix}_epoch_start_timestamp`,
        help: 'Estimated unix seconds when current epoch starts',
        labelNames: ['epoch']
    });

    private readonly marinadeEffectiveBidEpochGauge = new Gauge({
        name: `${this.metricPrefix}_marinade_effective_bid_epoch`,
        help: 'Marinade effective bid per epoch (pmpe) for target vote account',
        labelNames: ['epoch']
    });

    // validator voteAccount -> node identity mapping
    private validatorToIdentityMap: Record<string, string> = {};

    // vx.tools 응답 캐시 (identity 기준)
    private vxIncomeCache: Map<string, { ts: number, rows: any[] }> = new Map();
    private readonly VX_CACHE_TTL_MS = 60000;

    // SDK 기반 Eff. Bid 계산 결과 캐시
    private sdkEffBidCache: { ts: number, winningTotalPmpe: number, inflationPmpe: number, mevPmpe: number } | null = null;
    private readonly SDK_CACHE_TTL_MS = 10 * 60 * 1000;

    private toUniqueList(csv: string): string[] {
        return Array.from(new Set(csv.split(',').map(v => v.trim()).filter(Boolean)));
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
        help: 'Your validator last vote',
        labelNames: ['vote']
    });

    // private readonly validatorsCount = new Gauge({
    //     name: `${this.metricPrefix}_validators_count`,
    //     help: 'Validators count',
    // });

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly rpcUrl: string,
                       protected readonly votes: string,
                       protected readonly identities: string) {
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
        this.registry.registerMetric(this.blockFeesMedianGauge);
        this.registry.registerMetric(this.blockTipsMedianGauge);
        this.registry.registerMetric(this.clusterRequiredVersionGauge);
        this.registry.registerMetric(this.validatorReleaseVersionGauge);
        this.registry.registerMetric(this.epochMedianBaseFeesAvgGauge);
        this.registry.registerMetric(this.epochMedianPriorityFeesAvgGauge);
        this.registry.registerMetric(this.epochMedianMevTipsAvgGauge);
        this.registry.registerMetric(this.leaderSlotTsGauge);
        this.registry.registerMetric(this.epochEndTsGauge);
        this.registry.registerMetric(this.epochStartTsGauge);
        this.registry.registerMetric(this.marinadeEffectiveBidEpochGauge);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            // 1) 먼저 vote account -> identity 매핑 생성 (getVoteAccounts 1회 호출)
            await this.updateVoteAccounts(this.votes);

            // 2) 독립 작업 병렬 수행
            await Promise.all([
                this.updateBalance(this.votes + (this.identities ? ',' + this.identities : '')),
                this.updateDelegationsFromJPool(this.votes),
                this.updatePendingStakeFromJPool(this.votes),
                this.updateMarinadeScoring(this.votes),
                this.updateGlobalEffectiveBid(),
                this.updateEpochIncomeFromVx(this.votes),
                this.updateClusterRequiredVersions(),
                this.updateValidatorReleaseVersions(),
                this.updateEpochMedianFeesAverages(),
                this.updateLeaderWindowsAndEpochEnd(),
                this.updateMarinadeEffectiveBidEpoch(),
            ]);

            customMetrics = await this.registry.metrics();

        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    private async updateLeaderWindowsAndEpochEnd(): Promise<void> {
        try {
            this.leaderSlotTsGauge.reset();

            // 1) 현재 epoch/slot 정보
            const epochInfo = await this.post(this.rpcUrl, { method: 'getEpochInfo', params: [{ commitment: 'processed' }] } as any, response => response.data?.result);
            const epoch: number = Number(epochInfo?.epoch ?? NaN);
            const absoluteSlot: number = Number(epochInfo?.absoluteSlot ?? NaN);
            const slotIndex: number = Number(epochInfo?.slotIndex ?? NaN);
            const slotsInEpoch: number = Number(epochInfo?.slotsInEpoch ?? NaN);
            if (!Number.isFinite(epoch) || !Number.isFinite(absoluteSlot) || !Number.isFinite(slotIndex) || !Number.isFinite(slotsInEpoch)) return;
            const epochFirstSlot: number = absoluteSlot - slotIndex;

            // 2) 최근 성능 샘플로 슬롯당 초 계산
            const samples = await this.postWithCache('https://api.mainnet-beta.solana.com', { method: 'getRecentPerformanceSamples', params: [15] } as any, (response: { data: any }) => response.data?.result, 120000);
            const arr: any[] = Array.isArray(samples) ? samples : [];
            let totalSlots = 0; let totalSecs = 0;
            for (const s of arr) {
                const ns = Number(s?.numSlots ?? 0);
                const secs = Number(s?.samplePeriodSecs ?? 0);
                if (Number.isFinite(ns) && Number.isFinite(secs) && ns > 0 && secs > 0) {
                    totalSlots += ns; totalSecs += secs;
                }
            }
            if (!(totalSlots > 0 && totalSecs > 0)) return;
            const secondsPerSlot = totalSecs / totalSlots;
            const nowSec = Date.now() / 1000;

            // Epoch end timestamp (reuse secondsPerSlot, epochFirstSlot)
            const epochEndAbsSlot: number = epochFirstSlot + slotsInEpoch - 1;
            let deltaToEnd = epochEndAbsSlot - absoluteSlot;
            if (!Number.isFinite(deltaToEnd) || deltaToEnd < 0) deltaToEnd = 0;
            const epochEndTs = Math.floor(nowSec + (deltaToEnd * secondsPerSlot));
            this.epochEndTsGauge.labels(String(epoch)).set(epochEndTs);

            // Epoch start timestamp
            let deltaToStart = epochFirstSlot - absoluteSlot; // negative or zero
            if (!Number.isFinite(deltaToStart)) deltaToStart = 0;
            const epochStartTs = Math.floor(nowSec + (deltaToStart * secondsPerSlot));
            this.epochStartTsGauge.labels(String(epoch)).set(epochStartTs);

            // 3) 각 identity의 다음 20개 리더 구간(4-slot 윈도우) 첫 슬롯 타임스탬프 산출 + 과거 2개 보상 계산
            const identities = this.toUniqueList(this.identities);
            await Promise.all(identities.map(async (identity) => {
                try {
                    const schedObj = await this.postWithCache(this.rpcUrl, { method: 'getLeaderSchedule', params: [null, { identity }] } as any, (response: { data: any }) => response.data?.result, 60000);
                    if (!schedObj || typeof schedObj !== 'object') return;
                    const slotsRel: number[] = Array.isArray(schedObj[identity]) ? schedObj[identity] : [];
                    if (!Array.isArray(slotsRel) || slotsRel.length === 0) return;
                    // 윈도우 시작 슬롯들만 추출: floor(slot/4)*4 기준으로 dedup
                    const windowStartsRel = Array.from(new Set(
                        slotsRel
                            .map((i: any) => Number(i))
                            .filter((i: number) => Number.isFinite(i) && i >= slotIndex)
                            .map((i: number) => Math.floor(i / 4) * 4)
                    )).sort((a: number, b: number) => a - b).slice(0, 5);

                    // 과거 2개의 윈도우 시작 슬롯(현재 slotIndex 이전) 추출
                    const pastStartsRelAll = Array.from(new Set(
                        slotsRel
                            .map((i: any) => Number(i))
                            .filter((i: number) => Number.isFinite(i) && i < slotIndex)
                            .map((i: number) => Math.floor(i / 4) * 4)
                    )).sort((a: number, b: number) => a - b);
                    const lastTwoPastRel = pastStartsRelAll.slice(Math.max(0, pastStartsRelAll.length - 1));

                    // 미래 구간: rewards "0"
                    for (const startRel of windowStartsRel) {
                        const absSlot = epochFirstSlot + startRel;
                        const deltaSlots = absSlot - absoluteSlot;
                        const ts = Math.floor(nowSec + (deltaSlots * secondsPerSlot));
                        this.leaderSlotTsGauge.labels(identity, String(epoch), String(absSlot), '0').set(ts);
                    }

                    // 과거 2개 구간: 4슬롯 보상 합산 후 rewards 라벨 갱신
                    await Promise.all(lastTwoPastRel.map(async (relStart) => {
                        try {
                            const absStart = epochFirstSlot + relStart;
                            const slots = [absStart, absStart + 1, absStart + 2, absStart + 3];
                            const blocks = await Promise.all(slots.map(async (s) => {
                                return this.postWithCache(this.rpcUrl, {
                                    method: 'getBlock',
                                    params: [s, { encoding: 'json', transactionDetails: 'none', rewards: true }]
                                } as any, (response: { data: any }) => response.data?.result, 300000);
                            }));
                            let lamports = 0;
                            for (const b of blocks) {
                                const rewardsArr: any[] = Array.isArray(b?.rewards) ? b.rewards : [];
                                for (const r of rewardsArr) {
                                    if (String(r?.rewardType || r?.reward_type) === 'Fee') {
                                        lamports += Number(r?.lamports ?? 0);
                                    }
                                }
                            }
                            const sol = lamports / LAMPORTS_PER_SOL;
                            const deltaSlots = absStart - absoluteSlot;
                            const ts = Math.floor(nowSec + (deltaSlots * secondsPerSlot));
                            this.leaderSlotTsGauge.labels(identity, String(epoch), String(absStart), String(sol)).set(ts);
                        } catch (inner2) {
                            console.error('leaderSlotTsGauge rewards calc error', identity, relStart, inner2);
                        }
                    }));
                } catch (inner) {
                    console.error('updateUpcomingLeaderSlots identity', identity, inner);
                }
            }));
        } catch (e) {
            console.error('updateUpcomingLeaderSlots', e);
        }
    }

    private async updateBalance(addresses: string): Promise<void> {
        for (const address of this.toUniqueList(addresses)) {
            const available = await this.getAmount(this.apiUrl, {
                method: 'getBalance',
                params: [address]
            }, (json: any) => json.result.value);
            this.availableGauge.labels(address).set(available);

            this.balanceGauge.labels(address).set(available);
        }
    }

    // JPool: validator별 위임 출처별 합계를 수집
    private async updateDelegationsFromJPool(validators: string): Promise<void> {
        this.delegationBySourceGauge.reset();
        const voteAccounts = this.toUniqueList(validators);
        await Promise.all(voteAccounts.map(async (vote) => {
            try {
                const url = `https://api.jpool.one/delegation?vote=${vote}`;
                const arr = await this.getWithCache(url, (response: { data: any }) => response.data, this.getRandomCacheDuration(60000, 15000));
                if (Array.isArray(arr)) {
                    for (const item of arr) {
                        const source = String(item.stake_type || item.stakeType || 'unknown');
                        const amountLamports = Number(item.stake_amount ?? 0);
                        const amountSol = amountLamports / LAMPORTS_PER_SOL;
                        this.delegationBySourceGauge.labels(vote, source).set(amountSol);
                    }
                }
            } catch (e) {
                console.error('updateDelegationsFromJPool', e);
            }
        }));
    }

    private async updateVoteAccounts(validators: string): Promise<void> {
        const voteAccounts = this.toUniqueList(validators);
        await this.postWithCache(this.apiUrl, { method: 'getVoteAccounts' }, response => {
            const allValidators = _.concat(
                response.data.result.current.map((i: any) => {
                    i.status = 'current';
                    return i;
                }),
                response.data.result.delinquent.map((i: any) => {
                    i.status = 'delinquent';
                    return i;
                })
            );
            for (const vote of voteAccounts) {
                const myValidator = _.find(allValidators, (o: any) => o.votePubkey === vote);
                if (!myValidator) continue;
                this.activatedStakeGauge.labels(vote).set(myValidator.activatedStake / LAMPORTS_PER_SOL);
                this.activeGauge.labels(vote).set(myValidator.status === 'current' ? 1 : 0);
                this.commissionGauge.labels(vote).set(myValidator.commission);
                this.lastVoteGauge.labels(vote).set(myValidator.lastVote);
                if (myValidator.nodePubkey) {
                    this.validatorToIdentityMap[vote] = myValidator.nodePubkey;
                }
            }
        });
    }

    private async getAmount(url: string, data: { method: string, params?: string[] }, selector: (json: {}) => number): Promise<number> {
        return this.postWithCache(url, data, response => {
            return selector(response.data) / LAMPORTS_PER_SOL;
        });
    }

    // Epoch 값은 updateEpochIncomeFromVx에서만 갱신한다.

    private async updateClusterRequiredVersions(): Promise<void> {
        try {
            this.clusterRequiredVersionGauge.reset();

            const url = `https://api.solana.org/api/community/v1/sfdp_required_versions?cluster=mainnet-beta`;
            const data = await this.getWithCache(url, (response: { data: any }) => response.data, 60000);
            const items: any[] = Array.isArray(data?.data) ? data.data : [];
            if (items.length === 0) return;

            const latest = items[items.length - 1];
            const ep: number = Number(latest?.epoch ?? NaN);
            if (!Number.isFinite(ep)) return;
            const minAgave: string = String(latest?.agave_min_version ?? '');
            const minFrank: string = String(latest?.firedancer_min_version ?? '');
            this.clusterRequiredVersionGauge.labels(minAgave, minFrank).set(ep);
        } catch (e) {
            console.error('updateClusterRequiredVersions', e);
        }
    }

    private async updateValidatorReleaseVersions(): Promise<void> {
        try {
            this.validatorReleaseVersionGauge.reset();
            const voteAccounts = this.toUniqueList(this.votes);
            await Promise.all(voteAccounts.map(async (vote) => {
                try {
                    const url = `https://api.jpool.one/validators/${encodeURIComponent(vote)}`;
                    const data = await this.getWithCache(url, (response: { data: any }) => response.data, 60000);
                    const releaseVersion: string = String(data?.version ?? '');
                    if (releaseVersion) {
                        this.validatorReleaseVersionGauge.labels(vote, releaseVersion).set(1);
                    }
                } catch (inner) {
                    console.error(`updateValidatorReleaseVersions ${vote}`, inner);
                }
            }));
        } catch (e) {
            console.error('updateValidatorReleaseVersions', e);
        }
    }

    // Marinade scoring API → bid, min effective bid, bonds(=bondBalanceSol)
    private async updateMarinadeScoring(validators: string): Promise<void> {
        try {
            // 1. Scoring API에서 minEffectiveBid만 가져오기
            const scoringUrl = 'https://scoring.marinade.finance/api/v1/scores/sam?lastEpochs=1';
            const scoringList = await this.getWithCache(scoringUrl, (response: { data: any }) => response.data, 60000);
            
            // 2. Validator bonds API에서 bidPmpe, maxStakeWanted, bondBalanceSol 가져오기
            const bondsUrl = 'https://validator-bonds-api.marinade.finance/bonds';
            const bondsResponse = await this.getWithCache(bondsUrl, (response: { data: any }) => response.data, 60000);
            const bondsList = bondsResponse?.bonds || [];

            // 3. Commission(광고 커미션) / MEV 커미션 로드
            // Commission/MEV 커미션은 현재 my_bid 라벨에서 사용하지 않으므로 로드 생략
            
            if (!Array.isArray(scoringList) || !Array.isArray(bondsList)) return;
            
            const voteAccounts = validators.split(',').map(v => v.trim()).filter(Boolean);
            
            for (const vote of voteAccounts) {
                // Scoring API에서 minEffectiveBid 찾기
                const scoringFound = scoringList.find((it: any) => it && (it.voteAccount === vote));
                
                // Bonds API에서 나머지 값들 찾기
                const bondsFound = bondsList.find((it: any) => it && (it.vote_account === vote));
                if (bondsFound) {
                    const bidPmpe = Number(bondsFound.cpmpe ?? 0) / 1e9; // Convert from lamports to SOL
                    const maxStakeWanted = Number(bondsFound.max_stake_wanted ?? 0) / 1e9; // Convert from lamports to SOL
                    const bondBalanceSol = Number(bondsFound.funded_amount ?? 0) / 1e9; // Convert from lamports to SOL

                    this.marinadeMyBidGauge.labels(vote).set(bidPmpe);
                    this.marinadeMaxStakeWantedGauge.labels(vote).set(maxStakeWanted);
                    this.validatorBondsGauge.labels(vote).set(bondBalanceSol);
                } else if (scoringFound) {
                    // Bonds API에서 찾지 못한 경우 scoring API의 기존 값 사용
                    const bidPmpe = Number(scoringFound?.revShare?.bidPmpe ?? 0);
                    const maxStakeWanted = Number(scoringFound?.maxStakeWanted ?? 0);
                    const bondBalanceSol = Number(scoringFound?.values?.bondBalanceSol ?? 0);

                    this.marinadeMyBidGauge.labels(vote).set(bidPmpe);
                    this.marinadeMaxStakeWantedGauge.labels(vote).set(maxStakeWanted);
                    this.validatorBondsGauge.labels(vote).set(bondBalanceSol);
                }
            }
        } catch (e) {
            console.error('updateMarinadeScoring', e);
        }
    }

    // Marinade scoring API: 특정 voteAccount의 최근 epoch들 effectiveBid(pmpe)를 epoch 라벨로 저장
    private async updateMarinadeEffectiveBidEpoch(): Promise<void> {
        try {
            this.marinadeEffectiveBidEpochGauge.reset();
            const targetVote = '5BAi9YGCipHq4ZcXuen5vagRQqRTVTRszXNqBZC6uBPZ';
            const url = 'https://scoring.marinade.finance/api/v1/scores/sam?lastEpochs=8';
            const rows = await this.getWithCache(url, (response: { data: any }) => response.data, this.getRandomCacheDuration(60000, 15000));
            const arr: any[] = Array.isArray(rows) ? rows : [];
            for (const it of arr) {
                try {
                    if (!it || String(it.voteAccount || '') !== targetVote) continue;
                    const epoch = String(it.epoch ?? '');
                    if (!epoch) continue;
                    const eff = Number(it.effectiveBid ?? 0);
                    if (!Number.isFinite(eff)) continue;
                    this.marinadeEffectiveBidEpochGauge.labels(epoch).set(eff);
                } catch (inner) {
                    console.error('updateMarinadeEffectiveBidEpoch item error', inner);
                }
            }
        } catch (e) {
            console.error('updateMarinadeEffectiveBidEpoch', e);
        }
    }

    // validators API에서 commission_advertised를 가져와 vote_account별 매핑 생성
    private async loadValidatorsAdvertisedCommission(): Promise<Record<string, number>> {
        try {
            const url = 'https://validators-api.marinade.finance/validators?limit=9999&epochs=1';
            const data = await this.getWithCache(url, (response: { data: any }) => response.data, this.getRandomCacheDuration(60000, 15000));
            const arr: any[] = Array.isArray(data?.validators) ? data.validators : [];
            const map: Record<string, number> = {};
            for (const it of arr) {
                const vote = String(it?.vote_account || it?.vote || '');
                if (!vote) continue;
                const adv = Number(it?.commission_advertised);
                if (Number.isFinite(adv)) map[vote] = adv;
            }
            return map;
        } catch (e) {
            console.error('loadValidatorsAdvertisedCommission', e);
            return {};
        }
    }

    // MEV API에서 mev_commission_bps를 가져와 vote_account별 매핑 생성
    private async loadMevCommissionBps(): Promise<Record<string, number>> {
        try {
            const url = 'https://validators-api.marinade.finance/mev';
            const data = await this.getWithCache(url, (response: { data: any }) => response.data, this.getRandomCacheDuration(60000, 15000));
            // { validators: [ { vote_account, mev_commission_bps, ... }, ... ] } 형태만 처리
            const out: Record<string, number> = {};
            const arr: any[] = Array.isArray((data as any)?.validators) ? (data as any).validators : [];
            for (const it of arr) {
                const vote = String(it?.vote_account || '');
                const bps = Number(it?.mev_commission_bps);
                if (vote && Number.isFinite(bps)) out[vote] = bps;
            }
            return out;
        } catch (e) {
            console.error('loadMevCommissionBps', e);
            return {};
        }
    }

    // Global effective bid (pmpe) 계산 후 commission/mev_commission 라벨로 게이지에 설정
    private async updateGlobalEffectiveBid(): Promise<void> {
        try {
            this.marinadeMinEffectiveBidGauge.reset();

            const now = Date.now();
            let winningTotalPmpe: number;
            let baseInflPmpe: number;
            let baseMevPmpe: number;

            // 1) 캐시 사용 가능하면 활용
            if (this.sdkEffBidCache && (now - this.sdkEffBidCache.ts) < this.SDK_CACHE_TTL_MS) {
                ({ winningTotalPmpe, inflationPmpe: baseInflPmpe, mevPmpe: baseMevPmpe } = this.sdkEffBidCache);
                await this.applyEffBidToVotes(winningTotalPmpe, baseInflPmpe, baseMevPmpe);
                return;
            }

            // 2) SDK 실행하여 최신 값을 계산
            const configUrl = 'https://raw.githubusercontent.com/marinade-finance/ds-sam-pipeline/main/auction-config.json';
            const config = await this.getWithCache(configUrl, (response: { data: any }) => response.data, 60000);
            const req: any = (global as any).require ? (global as any).require : eval('require');
            const sdkMod: any = req('@marinade.finance/ds-sam-sdk');
            const dsSam = new sdkMod.DsSamSDK({ ...config, inputsSource: sdkMod.InputsSource.APIS, cacheInputs: false });

            const origLog = console.log; const origWarn = console.warn;
            try {
                console.log = () => {}; console.warn = () => {};
                const runRes = await dsSam.runFinalOnly();
                winningTotalPmpe = Number(runRes?.winningTotalPmpe ?? 0);
                const aggregated = await dsSam.getAggregatedData();
                baseInflPmpe = Number(aggregated?.rewards?.inflationPmpe ?? 0);
                baseMevPmpe = Number(aggregated?.rewards?.mevPmpe ?? 0);
            } finally {
                console.log = origLog; console.warn = origWarn;
            }

            // 3) 캐시 갱신 및 적용
            this.sdkEffBidCache = { ts: now, winningTotalPmpe, inflationPmpe: baseInflPmpe, mevPmpe: baseMevPmpe };
            await this.applyEffBidToVotes(winningTotalPmpe, baseInflPmpe, baseMevPmpe);
        } catch (e) {
            console.error('updateGlobalEffectiveBid', e);
        }
    }

    // Helper: 두 케이스 (0,0), (5,10) 사전계산 후 vote별로 선택하여 게이지 설정
    private async applyEffBidToVotes(winningTotalPmpe: number, baseInflPmpe: number, baseMevPmpe: number): Promise<void> {
        const eff00 = Math.max(0, Number(winningTotalPmpe) - (baseInflPmpe * (1 - 0) + baseMevPmpe * (1 - 0)));
        const eff510 = Math.max(0, Number(winningTotalPmpe) - (baseInflPmpe * (1 - 0.05) + baseMevPmpe * (1 - 0.10)));

        const [commissionByVote, mevCommissionBpsByVote] = await Promise.all([
            this.loadValidatorsAdvertisedCommission(),
            this.loadMevCommissionBps(),
        ]);

        for (const vote of this.toUniqueList(this.votes)) {
            const comm = Number(commissionByVote[vote]);
            const mevBps = Number(mevCommissionBpsByVote[vote]);
            const is510 = Number.isFinite(comm) && Number.isFinite(mevBps) && Math.round(comm) === 5 && Math.round(mevBps) === 1000;
            const useEff = is510 ? eff510 : eff00;
            const commLabel = is510 ? '5' : '0';
            const mevLabel = is510 ? '10' : '0';
            this.marinadeMinEffectiveBidGauge.labels(vote, commLabel, mevLabel).set(useEff);
        }
    }

    // vx.tools epoch income → slots/fees/tips 집계
    private async updateEpochIncomeFromVx(validators: string): Promise<void> {
        // epoch 스코프 지표는 이전 epoch 라벨이 남지 않도록 매 호출마다 리셋
        // (현재 epoch 데이터만 노출되게 함)
        this.slotsAssignedGauge.reset();
        this.slotsProducedGauge.reset();
        this.slotsSkippedGauge.reset();
        this.blockFeesTotalGauge.reset();
        this.mevFeesTotalGauge.reset();
        this.blockFeesMedianGauge.reset();
        this.blockTipsMedianGauge.reset();

        const voteAccounts = this.toUniqueList(validators);
        await Promise.all(voteAccounts.map(async (vote) => {
            const identity = this.validatorToIdentityMap[vote];
            if (!identity) return;
            try {
                const now = Date.now();
                const cached = this.vxIncomeCache.get(identity);
                let rows: any[] = [];
                if (cached && (now - cached.ts) < this.VX_CACHE_TTL_MS) {
                    rows = cached.rows;
                } else {
                    const url = 'https://api.vx.tools/epochs/income';
                    const payload = { identity, limit: 1 };
                    const data = await this.postWithCache(url, payload, (response: { data: any }) => response.data, this.VX_CACHE_TTL_MS);
                    rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
                    this.vxIncomeCache.set(identity, { ts: now, rows });
                }
                if (!Array.isArray(rows) || rows.length === 0) return;
                const latest = rows[rows.length - 1];
                const epochLabel = String(latest?.epoch ?? '');

                const totalSlots = Number(latest?.totalSlots ?? 0);
                const confirmedSlots = Number(latest?.confirmedSlots ?? 0);
                const skippedSlots = Number(latest?.skippedSlots ?? Math.max(totalSlots - confirmedSlots, 0));

                this.slotsAssignedGauge.labels(vote, epochLabel).set(totalSlots);
                this.slotsProducedGauge.labels(vote, epochLabel).set(confirmedSlots);
                this.slotsSkippedGauge.labels(vote, epochLabel).set(skippedSlots);

                const baseFeesTotal = Number(latest?.totalIncome?.baseFees ?? 0);
                const priorityFeesTotal = Number(latest?.totalIncome?.priorityFees ?? 0);
                const mevTipsTotal = Number(latest?.totalIncome?.mevTips ?? 0);

                const baseFeesMedian = Number(latest?.medianIncome?.baseFees ?? 0);
                const priorityFeesMedian = Number(latest?.medianIncome?.priorityFees ?? 0);
                const mevTipsMedian = Number(latest?.medianIncome?.mevTips ?? 0);

                const totalFeesSol = (baseFeesTotal + priorityFeesTotal) / LAMPORTS_PER_SOL;
                const mevFeesSol = mevTipsTotal / LAMPORTS_PER_SOL;
                const medianFeesSol = (baseFeesMedian + priorityFeesMedian) / LAMPORTS_PER_SOL;
                const medianTipsSol = mevTipsMedian / LAMPORTS_PER_SOL;

                this.blockFeesTotalGauge.labels(vote, epochLabel).set(totalFeesSol);
                this.mevFeesTotalGauge.labels(vote, epochLabel).set(mevFeesSol);
                this.blockFeesMedianGauge.labels(vote, epochLabel).set(medianFeesSol);
                this.blockTipsMedianGauge.labels(vote, epochLabel).set(medianTipsSol);
            } catch (e) {
                console.error('updateEpochIncomeFromVx', e);
            }
        }));
    }

    // vx.tools leaderboard: stake 상위 50명의 totalIncome 합계를 confirmedSlots 합으로 나눈 평균(슬롯당)
    private async updateEpochMedianFeesAverages(): Promise<void> {
        try {
            this.epochMedianBaseFeesAvgGauge.reset();
            this.epochMedianPriorityFeesAvgGauge.reset();
            this.epochMedianMevTipsAvgGauge.reset();

            const url = 'https://api.vx.tools/epochs/leaderboard/income';
            const payload = {} as any;
            const rows = await this.postWithCache(url, payload, (response: { data: any }) => response.data, this.getRandomCacheDuration(60000, 15000));
            // expected shape: { epoch: number, records: [] }
            const epochFromRoot = rows && typeof rows === 'object' ? rows.epoch : undefined;
            const records: any[] = Array.isArray(rows?.records)
                ? rows.records
                : (Array.isArray(rows) ? rows : (Array.isArray(rows?.data) ? rows.data : []));
            if (!Array.isArray(records) || records.length === 0) return;

            // stake 기준 정렬 후 상위 50
            const sorted = [...records].sort((a, b) => Number(b?.stake ?? 0) - Number(a?.stake ?? 0));
            const top = sorted.slice(0, 50);
            const epochLabel = String(epochFromRoot ?? top[0]?.epoch ?? '');
            if (!epochLabel) return;

            const totalBaseLamports = top.reduce((acc, it) => acc + Number(it?.totalIncome?.baseFees ?? 0), 0);
            const totalPriorityLamports = top.reduce((acc, it) => acc + Number(it?.totalIncome?.priorityFees ?? 0), 0);
            const totalMevLamports = top.reduce((acc, it) => acc + Number(it?.totalIncome?.mevTips ?? 0), 0);
            const totalConfirmedSlots = top.reduce((acc, it) => acc + Number(it?.confirmedSlots ?? 0), 0);

            if (!Number.isFinite(totalConfirmedSlots) || totalConfirmedSlots <= 0) return;

            const baseAvg = (totalBaseLamports / totalConfirmedSlots) / LAMPORTS_PER_SOL;
            const priorityAvg = (totalPriorityLamports / totalConfirmedSlots) / LAMPORTS_PER_SOL;
            const mevAvg = (totalMevLamports / totalConfirmedSlots) / LAMPORTS_PER_SOL;

            this.epochMedianBaseFeesAvgGauge.labels(epochLabel).set(baseAvg);
            this.epochMedianPriorityFeesAvgGauge.labels(epochLabel).set(priorityAvg);
            this.epochMedianMevTipsAvgGauge.labels(epochLabel).set(mevAvg);
        } catch (e) {
            console.error('updateEpochMedianFeesAverages', e);
        }
    }

    // JPool pending stake: activation/deactivation by source aggregated in SOL
    private async updatePendingStakeFromJPool(validators: string): Promise<void> {
        this.pendingActivationBySourceGauge.reset();
        this.pendingDeactivationBySourceGauge.reset();
        const voteAccounts = this.toUniqueList(validators);
        await Promise.all(voteAccounts.map(async (vote) => {
            try {
                const url = `https://api.jpool.one/validators/${vote}/pending-stake`;
                const data = await this.getWithCache(url, (response: { data: any }) => response.data, this.getRandomCacheDuration(60000, 15000));
                const accounts: any[] = Array.isArray(data?.stake_accounts) ? data.stake_accounts : [];
                if (accounts.length === 0) return;

                const activationBySource: Record<string, number> = {};
                const deactivationBySource: Record<string, number> = {};

                for (const it of accounts) {
                    const source = String(it?.stake_type || 'unknown') || 'unknown';
                    const lamports = Number(it?.delegated_amount ?? 0);
                    const type = String(it?.type || '').toLowerCase();
                    if (type === 'activation') {
                        activationBySource[source] = (activationBySource[source] || 0) + lamports;
                    } else if (type === 'deactivation') {
                        deactivationBySource[source] = (deactivationBySource[source] || 0) + lamports;
                    }
                }

                for (const source of Object.keys(activationBySource)) {
                    const lamports = activationBySource[source];
                    this.pendingActivationBySourceGauge.labels(vote, source).set(lamports / LAMPORTS_PER_SOL);
                }
                for (const source of Object.keys(deactivationBySource)) {
                    const lamports = deactivationBySource[source];
                    this.pendingDeactivationBySourceGauge.labels(vote, source).set(lamports / LAMPORTS_PER_SOL);
                }
            } catch (e) {
                console.error('updatePendingStakeFromJPool', e);
            }
        }));
    }

}