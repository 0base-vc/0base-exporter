import TargetAbstract from "../../target.abstract";
import { Gauge, Registry } from 'prom-client';
import axios from 'axios';

export default class Canopy extends TargetAbstract {
    private readonly decimalPlaces = parseInt(process.env.DECIMAL_PLACES) || 6;
    protected readonly metricPrefix = 'canopy';
    protected readonly registry = new Registry();

    protected readonly availableGauge = new Gauge({
        name: `${this.metricPrefix}_address_available`,
        help: 'Available balance of address',
        labelNames: ['address', 'denom']
    });
    protected readonly unbondingGauge = new Gauge({
        name: `${this.metricPrefix}_address_unbonding`,
        help: 'Unbonding balance of address',
        labelNames: ['address', 'denom']
    });
    protected readonly rewardsGauge = new Gauge({
        name: `${this.metricPrefix}_address_rewards`,
        help: 'Rewards of address',
        labelNames: ['address', 'denom']
    });
    protected readonly validatorPowerGauge = new Gauge({
        name: `${this.metricPrefix}_validator_power`,
        help: 'Validator staked amount',
        labelNames: ['validator']
    });
    protected readonly rankGauge = new Gauge({
        name: `${this.metricPrefix}_validator_rank`,
        help: 'Your rank of validators',
        labelNames: ['validator']
    });
    protected readonly rivalsPowerGauge = new Gauge({
        name: `${this.metricPrefix}_validator_power_rivals`,
        help: 'Voting power of Rivals',
        labelNames: ['rank']
    });
    protected readonly maxValidatorGauge = new Gauge({
        name: `${this.metricPrefix}_staking_parameters_max_validator_count`,
        help: 'Limitation of validators count',
    });
    protected readonly proposalsGauge = new Gauge({
        name: `${this.metricPrefix}_gov_proposals_count`,
        help: 'Gov voting period proposals count',
    });

    public constructor(
        protected readonly existMetrics: string,
        protected readonly apiUrl: string,
        protected readonly rpcUrl: string,
        protected readonly addresses: string,
        protected readonly validator: string
    ) {
        super(existMetrics, apiUrl, rpcUrl, addresses, validator);
        this.registry.registerMetric(this.availableGauge);
        this.registry.registerMetric(this.unbondingGauge);
        this.registry.registerMetric(this.rewardsGauge);
        this.registry.registerMetric(this.validatorPowerGauge);
        this.registry.registerMetric(this.rankGauge);
        this.registry.registerMetric(this.rivalsPowerGauge);
        this.registry.registerMetric(this.maxValidatorGauge);
        this.registry.registerMetric(this.proposalsGauge);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            await Promise.all([
                this.updateAddressBalance(this.addresses),
                this.updateRank(this.validator),
                this.updateMaxValidator(),
                this.updateProposalsCount()
            ]);
            customMetrics = await this.registry.metrics();
        } catch (e) {
            console.error('makeMetrics', e);
        }
        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    // Canopy는 위임/언본딩/리워드 개념이 없으므로 0으로 처리
    protected async updateAddressBalance(addresses: string): Promise<void> {
        for (const address of addresses.split(',').filter((address) => !address.startsWith('0x'))) {
            // 1. 잔액 조회
            try {
                const res = await axios.post(`${this.apiUrl}/v1/query/account`, { address });
                const amount = res.data.amount ? Number(res.data.amount) / Math.pow(10, this.decimalPlaces) : 0;
                this.availableGauge.labels(address, 'uCNPY').set(amount);
            } catch (e) {
                console.error('updateAddressBalance: available', address, e);
                this.availableGauge.labels(address, 'uCNPY').set(0);
            }
            // 2. delegated/unbonding/rewards: 0으로 세팅
            this.unbondingGauge.labels(address, 'uCNPY').set(0);
            this.rewardsGauge.labels(address, 'uCNPY').set(0);
        }
    }

    // Validator 랭킹 및 rivals power
    protected async updateRank(validator: string): Promise<void> {
        try {
            const res = await axios.post(`${this.apiUrl}/v1/query/validators`, { height: 0 });
            const validators: any[] = res.data.results || [];
            // stakedAmount 내림차순 정렬
            const sorted = validators
                .map((v) => ({ ...v, stakedAmount: Number(v.stakedAmount) }))
                .sort((a, b) => b.stakedAmount - a.stakedAmount);
            const rank = sorted.findIndex((v) => v.address === validator) + 1;
            const me = sorted[rank - 1];
            const above = sorted[rank - 2] || me;
            const below = sorted[rank] || { stakedAmount: 0 };
            this.rankGauge.labels(validator).set(rank);
            this.rivalsPowerGauge.labels('above').set(Number(above.stakedAmount) / Math.pow(10, this.decimalPlaces));
            this.rivalsPowerGauge.labels('below').set(Number(below.stakedAmount) / Math.pow(10, this.decimalPlaces));
            
            // validator의 stakedAmount를 validatorPowerGauge에 설정
            if (me) {
                this.validatorPowerGauge.labels(validator).set(Number(me.stakedAmount) / Math.pow(10, this.decimalPlaces));
            } else {
                this.validatorPowerGauge.labels(validator).set(0);
            }
        } catch (e) {
            console.error('updateRank', validator, e);
            this.rankGauge.labels(validator).set(0);
            this.rivalsPowerGauge.labels('above').set(0);
            this.rivalsPowerGauge.labels('below').set(0);
            this.validatorPowerGauge.labels(validator).set(0);
        }
    }

    // 최대 validator 수
    protected async updateMaxValidator(): Promise<void> {
        try {
            const res = await axios.post(`${this.apiUrl}/v1/query/params`, { height: 0 });
            const max = res.data.validator?.maxCommitteeSize ? Number(res.data.validator.maxCommitteeSize) : 0;
            this.maxValidatorGauge.set(max);
        } catch (e) {
            console.error('updateMaxValidator', e);
            this.maxValidatorGauge.set(0);
        }
    }

    // proposal 개수
    private async updateProposalsCount(): Promise<void> {
        try {
            const res = await axios.get(`${this.apiUrl}/v1/gov/proposals`);
            const count = Array.isArray(res.data.proposals) ? res.data.proposals.length : 0;
            this.proposalsGauge.set(count);
        } catch (e) {
            console.error('updateProposalsCount', e);
            this.proposalsGauge.set(0);
        }
    }
}

