// ENV VALIDATOR = Vote key
// ENV ADDRESS = Identity key

import TargetAbstract from "../../target.abstract";
import { Gauge, Registry } from 'prom-client';
import * as _ from 'lodash';

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

    private readonly onboardingPriorityGauge = new Gauge({
        name: `${this.metricPrefix}_onboarding_priority`,
        help: 'Validator onboarding priority number',
        labelNames: ['identity']
    });

    private readonly clusterRequiredVersionGauge = new Gauge({
        name: `${this.metricPrefix}_cluster_required_versions`,
        help: 'Cluster required client versions (Agave/Frankendancer) labeled as strings; value equals epoch',
        labelNames: ['min_version_agave', 'min_version_frankendancer']
    });

    private readonly validatorReleaseVersionGauge = new Gauge({
        name: `${this.metricPrefix}_validator_release_version`,
        help: 'Validator release client version labeled as string; value fixed to 1',
        labelNames: ['identity', 'release_version']
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

    private readonly tvcEarnedDeltaGauge = new Gauge({
        name: `${this.metricPrefix}_validator_tvc_earned_delta`,
        help: 'Earned vote credits delta in finalized window since last scrape',
        labelNames: ['vote']
    });

    private readonly tvcMissedDeltaGauge = new Gauge({
        name: `${this.metricPrefix}_validator_tvc_missed_delta`,
        help: 'Missed vote credits (expected - earned) in finalized window since last scrape',
        labelNames: ['vote']
    });

    // private readonly validatorsCount = new Gauge({
    //     name: `${this.metricPrefix}_validators_count`,
    //     help: 'Validators count',
    // });

    private static readonly LAMPORTS_PER_SOL = 1e9;

    // Onboarding priority 조회 최적화 상태 관리
    private readonly onboardingFailedValidators: Set<string> = new Set();
    private readonly onboardingAllowedValidators: Set<string> = new Set();
    private onboardingSelectionLocked: boolean = false;

    private toUniqueList(csv: string): string[] {
        return Array.from(new Set(csv.split(',').map(v => v.trim()).filter(Boolean)));
    }

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
        this.registry.registerMetric(this.lastVoteGauge);
        this.registry.registerMetric(this.onboardingPriorityGauge);
        this.registry.registerMetric(this.clusterRequiredVersionGauge);
        this.registry.registerMetric(this.validatorReleaseVersionGauge);
        this.registry.registerMetric(this.tvcEarnedDeltaGauge);
        this.registry.registerMetric(this.tvcMissedDeltaGauge);
        this.registry.registerMetric(this.leaderSlotTsGauge);
        this.registry.registerMetric(this.epochEndTsGauge);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            await Promise.all([
                this.updateBalance(this.votes + (this.identities ? ',' + this.identities : '')),
                this.updateVoteAccounts(this.votes),
                this.updateOnboardingPriority(this.identities),
                this.updateClusterRequiredVersions(),
                this.updateValidatorReleaseVersions(),
                this.updateTvcDeltas(this.votes),
                this.updateLeaderWindowsAndEpochEnd(),
            ]);

            customMetrics = await this.registry.metrics();

        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    // merged into updateLeaderWindowsAndEpochEnd

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
            const samples = await this.postWithCache('https://api.testnet.solana.com', { method: 'getRecentPerformanceSamples', params: [15] } as any, (response: { data: any }) => response.data?.result, 120000);
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

            // Epoch end timestamp
            const epochEndAbsSlot: number = epochFirstSlot + slotsInEpoch - 1;
            let deltaToEnd = epochEndAbsSlot - absoluteSlot;
            if (!Number.isFinite(deltaToEnd) || deltaToEnd < 0) deltaToEnd = 0;
            const epochEndTs = Math.floor(nowSec + (deltaToEnd * secondsPerSlot));
            this.epochEndTsGauge.labels(String(epoch)).set(epochEndTs);

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
                            const sol = lamports / Solana.LAMPORTS_PER_SOL;
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
        this.availableGauge.reset();
        this.balanceGauge.reset();
        for (const address of this.toUniqueList(addresses)) {
            const available = await this.getAmount(this.apiUrl, {
                method: 'getBalance',
                params: [address]
            }, (json: any) => json.result.value);
            this.availableGauge.labels(address).set(available);

            this.balanceGauge.labels(address).set(available);
        }
    }

    private async updateVoteAccounts(validators: string): Promise<void> {
        this.activatedStakeGauge.reset();
        this.activeGauge.reset();
        this.commissionGauge.reset();
        this.lastVoteGauge.reset();
        const voteAccounts = this.toUniqueList(validators);
        await this.postWithCache(this.apiUrl, { method: 'getVoteAccounts' }, response => {

            const allValidators = _.concat(response.data.result.current.map((i: any) => {
                i.status = 'current'
                return i;
            }), response.data.result.delinquent.map((i: any) => {
                i.status = 'delinquent'
                return i;
            }));

            for (const vote of voteAccounts) {
                const myValidator = _.find(allValidators, (o: any) => {
                    return o.votePubkey === vote;
                });
                if (!myValidator) continue;

                this.activatedStakeGauge.labels(vote).set(myValidator.activatedStake / Solana.LAMPORTS_PER_SOL);
                this.activeGauge.labels(vote).set(myValidator.status === 'current' ? 1 : 0);
                this.commissionGauge.labels(vote).set(myValidator.commission);
                this.lastVoteGauge.labels(vote).set(myValidator.lastVote);
            }
        });
    }

    private async getAmount(url: string, data: { method: string, params?: string[] }, selector: (json: {}) => number): Promise<number> {
        return this.postWithCache(url, data, response => {
            return selector(response.data) / Solana.LAMPORTS_PER_SOL;
        });
    }

    private async updateOnboardingPriority(identities: string): Promise<void> {
        this.onboardingPriorityGauge.reset();
        const identityAccounts = this.toUniqueList(identities);

        // 첫 실행 전: 실패한 주소 제외, 성공/실패를 판별해 집합에 기록
        // 첫 실행 이후(locked): 최초 성공한 주소만 계속 조회
        const targets: string[] = this.onboardingSelectionLocked
            ? identityAccounts.filter(v => this.onboardingAllowedValidators.has(v))
            : identityAccounts.filter(v => !this.onboardingFailedValidators.has(v));

        await Promise.all(targets.map(async (identity) => {
            try {
                const onboardingData = await this.getWithCache(
                    `https://api.solana.org/api/validators/${identity}?cacheStatus=enable`,
                    (response: { data: any }) => response.data
                );

                const hasValue = onboardingData && onboardingData.onboardingNumber !== null && onboardingData.onboardingNumber !== undefined;
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
        }));

        // 첫 패스 이후엔 성공한 주소만 계속 확인하도록 고정
        if (!this.onboardingSelectionLocked) {
            this.onboardingSelectionLocked = true;
        }
    }

    private async updateClusterRequiredVersions(): Promise<void> {
        try {
            this.clusterRequiredVersionGauge.reset();
            const url = `https://api.solana.org/api/community/v1/sfdp_required_versions?cluster=testnet`;
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

    private async getCurrentEpochNumber(): Promise<number | null> {
        try {
            const epoch = await this.postWithCache(this.apiUrl, { method: 'getEpochInfo' }, response => {
                return Number(response.data?.result?.epoch ?? NaN);
            });
            return Number.isFinite(epoch) ? epoch : null;
        } catch (e) {
            console.error('getCurrentEpochNumber', e);
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
            await Promise.all(identityAccounts.map(async (identity) => {
                try {
                    const url = `https://api.solana.org/api/validators/details?pk=${encodeURIComponent(identity)}&epoch=${encodeURIComponent(String(targetEpoch))}`;
                    const data = await this.getWithCache(url, (response: { data: any }) => response.data, 60000);
                    const releaseVersion: string = String(data?.stats?.release_version ?? '');
                    if (releaseVersion) {
                        this.validatorReleaseVersionGauge.labels(identity, releaseVersion).set(1);
                    }
                } catch (inner) {
                    console.error(`updateValidatorReleaseVersions ${identity}`, inner);
                }
            }));
        } catch (e) {
            console.error('updateValidatorReleaseVersions', e);
        }
    }

    // ---------------------- TVC deltas (earned/missed) ----------------------
    private readonly tvcStateByVote: Map<string, { epoch: number, finalizedSlot: number, earnedNow: number }> = new Map();

    private async updateTvcDeltas(validators: string): Promise<void> {
        try {
            this.tvcEarnedDeltaGauge.reset();
            this.tvcMissedDeltaGauge.reset();

            // Fetch finalized epoch info and slot with short cache to keep deltas responsive
            const epoch: number = await this.post(this.rpcUrl, { method: 'getEpochInfo', params: [{ commitment: 'finalized' }] } as any, response => {
                return Number(response.data?.result?.epoch ?? NaN);
            });
            if (!Number.isFinite(epoch)) return;

            const finalizedSlot: number = await this.post(this.rpcUrl, { method: 'getSlot', params: [{ commitment: 'finalized' }] } as any, response => {
                return Number(response.data?.result ?? NaN);
            });
            if (!Number.isFinite(finalizedSlot)) return;

            // Get all vote accounts at finalized commitment
            const voteAccountsResponse = await this.post(this.rpcUrl, { method: 'getVoteAccounts', params: [{ commitment: 'finalized' }] } as any, response => response.data);
            const currentList: any[] = Array.isArray(voteAccountsResponse?.result?.current) ? voteAccountsResponse.result.current : [];
            const delinquentList: any[] = Array.isArray(voteAccountsResponse?.result?.delinquent) ? voteAccountsResponse.result.delinquent : [];
            const allValidators: any[] = _.concat(currentList.map((i: any) => { i.status = 'current'; return i; }), delinquentList.map((i: any) => { i.status = 'delinquent'; return i; }));

            for (const vote of this.toUniqueList(validators)) {
                const me: any = _.find(allValidators, (o: any) => o.votePubkey === vote);
                if (!me) continue;

                const epochCredits = Array.isArray(me.epochCredits) && me.epochCredits.length > 0 ? me.epochCredits[me.epochCredits.length - 1] : null;
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
                        earnedNow: earnedNow
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
                    earnedNow: earnedNow
                });
            }
        } catch (e) {
            console.error('updateTvcDeltas', e);
        }
    }

}