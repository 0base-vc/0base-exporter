import TargetAbstract from "../target.abstract";
import { Gauge, Registry } from 'prom-client';
import * as _ from 'lodash';
import axios from 'axios';

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
        labelNames: ['validator']
    });

    private readonly activeGauge = new Gauge({
        name: `${this.metricPrefix}_validator_active`,
        help: 'Your validator active',
        labelNames: ['validator']
    });

    private readonly commissionGauge = new Gauge({
        name: `${this.metricPrefix}_validator_commission`,
        help: 'Your validator commission',
        labelNames: ['validator']
    });

    private readonly validatorBondsGauge = new Gauge({
        name: `${this.metricPrefix}_validator_bonds`,
        help: 'Your validator bonds',
        labelNames: ['validator']
    });

    private readonly delegationBySourceGauge = new Gauge({
        name: `${this.metricPrefix}_delegation_sol`,
        help: 'Delegations to validator by source',
        labelNames: ['validator', 'source']
    });

    private readonly marinadeMinEffectiveBidGauge = new Gauge({
        name: `${this.metricPrefix}_marinade_min_effective_bid_sol`,
        help: 'Minimum effective bid required to receive delegation from Marinade',
        labelNames: ['validator']
    });

    private readonly marinadeMyBidGauge = new Gauge({
        name: `${this.metricPrefix}_marinade_my_bid_sol`,
        help: 'Current bid value our validator has set in Marinade',
        labelNames: ['validator']
    });

    private readonly slotsAssignedGauge = new Gauge({
        name: `${this.metricPrefix}_slots_assigned_total`,
        help: 'Total number of leader slots assigned to our validator in the current epoch',
        labelNames: ['validator', 'epoch']
    });

    private readonly slotsProducedGauge = new Gauge({
        name: `${this.metricPrefix}_slots_produced_total`,
        help: 'Number of leader slots we successfully produced in the current epoch',
        labelNames: ['validator', 'epoch']
    });

    private readonly slotsSkippedGauge = new Gauge({
        name: `${this.metricPrefix}_slots_skipped_total`,
        help: 'Number of leader slots assigned but not produced in the current epoch',
        labelNames: ['validator', 'epoch']
    });

    private readonly blockFeesTotalGauge = new Gauge({
        name: `${this.metricPrefix}_block_fees_total_sol`,
        help: 'Total transaction fees from blocks we produced',
        labelNames: ['validator', 'epoch']
    });

    private readonly mevFeesTotalGauge = new Gauge({
        name: `${this.metricPrefix}_mev_fees_total_sol`,
        help: 'Total MEV-related fees collected',
        labelNames: ['validator', 'epoch']
    });

    private readonly blockFeesMedianGauge = new Gauge({
        name: `${this.metricPrefix}_block_fees_median_sol`,
        help: 'Median transaction fees per produced block',
        labelNames: ['validator', 'epoch']
    });

    private readonly blockTipsMedianGauge = new Gauge({
        name: `${this.metricPrefix}_block_tips_median_sol`,
        help: 'Median block tips per produced block',
        labelNames: ['validator', 'epoch']
    });

    // validator voteAccount -> node identity mapping
    private validatorToIdentityMap: Record<string, string> = {};

    // vx.tools 응답 캐시 (identity 기준)
    private vxIncomeCache: Map<string, { ts: number, rows: any[] }> = new Map();
    private readonly VX_CACHE_TTL_MS = 60000;

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
        labelNames: ['validator']
    });

    // private readonly validatorsCount = new Gauge({
    //     name: `${this.metricPrefix}_validators_count`,
    //     help: 'Validators count',
    // });

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly rpcUrl: string,
                       protected readonly addresses: string,
                       protected readonly validators: string) {
        super(existMetrics, apiUrl, rpcUrl, addresses, validators);

        this.registry.registerMetric(this.balanceGauge);
        this.registry.registerMetric(this.availableGauge);
        this.registry.registerMetric(this.activatedStakeGauge);

        this.registry.registerMetric(this.activeGauge);
        this.registry.registerMetric(this.commissionGauge);
        this.registry.registerMetric(this.validatorBondsGauge);
        this.registry.registerMetric(this.lastVoteGauge);
        this.registry.registerMetric(this.delegationBySourceGauge);
        this.registry.registerMetric(this.marinadeMinEffectiveBidGauge);
        this.registry.registerMetric(this.marinadeMyBidGauge);
        this.registry.registerMetric(this.slotsAssignedGauge);
        this.registry.registerMetric(this.slotsProducedGauge);
        this.registry.registerMetric(this.slotsSkippedGauge);
        this.registry.registerMetric(this.blockFeesTotalGauge);
        this.registry.registerMetric(this.mevFeesTotalGauge);
        this.registry.registerMetric(this.blockFeesMedianGauge);
        this.registry.registerMetric(this.blockTipsMedianGauge);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            // 1) 먼저 vote account -> identity 매핑 생성 (getVoteAccounts 1회 호출)
            await this.updateVoteAccounts(this.validators);

            // 2) 독립 작업 병렬 수행
            await Promise.all([
                this.updateBalance(this.addresses),
                this.updateDelegationsFromJPool(this.validators),
                this.updateMarinadeScoring(this.validators),
                this.updateEpochIncomeFromVx(this.validators),
            ]);

            customMetrics = await this.registry.metrics();

        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
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
        const voteAccounts = this.toUniqueList(validators);
        await Promise.all(voteAccounts.map(async (vote) => {
            try {
                const url = `https://api.jpool.one/delegation?vote=${vote}`;
                const arr = await this.getWithCache(url, (response: { data: any }) => response.data);
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
            for (const validator of voteAccounts) {
                const myValidator = _.find(allValidators, (o: any) => o.votePubkey === validator);
                if (!myValidator) continue;
                this.activatedStakeGauge.labels(validator).set(myValidator.activatedStake / LAMPORTS_PER_SOL);
                this.activeGauge.labels(validator).set(myValidator.status === 'current' ? 1 : 0);
                this.commissionGauge.labels(validator).set(myValidator.commission);
                this.lastVoteGauge.labels(validator).set(myValidator.lastVote);
                if (myValidator.nodePubkey) {
                    this.validatorToIdentityMap[validator] = myValidator.nodePubkey;
                }
            }
        });
    }

    private async getAmount(url: string, data: { method: string, params?: string[] }, selector: (json: {}) => number): Promise<number> {
        return this.postWithCache(url, data, response => {
            return selector(response.data) / LAMPORTS_PER_SOL;
        });
    }

    // Marinade scoring API → bid, min effective bid, bonds(=bondBalanceSol)
    private async updateMarinadeScoring(validators: string): Promise<void> {
        try {
            const url = 'https://scoring.marinade.finance/api/v1/scores/sam?lastEpochs=1';
            const list = await this.getWithCache(url, (response: { data: any }) => response.data, 60000);
            if (!Array.isArray(list)) return;
            const voteAccounts = validators.split(',').map(v => v.trim()).filter(Boolean);
            for (const vote of voteAccounts) {
                const found = list.find((it: any) => it && (it.voteAccount === vote));
                if (!found) continue;
                const bidPmpe = Number(found?.revShare?.bidPmpe ?? 0);
                const minEffectiveBid = Number(found?.effectiveBid ?? 0);
                const bondBalanceSol = Number(found?.values?.bondBalanceSol ?? 0);

                this.marinadeMyBidGauge.labels(vote).set(bidPmpe);
                this.marinadeMinEffectiveBidGauge.labels(vote).set(minEffectiveBid);
                this.validatorBondsGauge.labels(vote).set(bondBalanceSol);
            }
        } catch (e) {
            console.error('updateMarinadeScoring', e);
        }
    }

    // vx.tools epoch income → slots/fees/tips 집계
    private async updateEpochIncomeFromVx(validators: string): Promise<void> {
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
                    const { data } = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
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

}