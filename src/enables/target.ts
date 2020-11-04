import TargetAbstract from "../target.abstract";
import axios from 'axios';
import {Registry, Gauge} from 'prom-client';
import * as _ from 'lodash';

export default class Target extends TargetAbstract {
    private readonly existMetricUrl = process.env.METRIC_EXIST_URL;
    private readonly lcdUrl = process.env.METRIC_LCD_URL;
    private readonly address = process.env.METRIC_ADDRESS;
    private readonly validatorAddress = process.env.METRIC_VALIDATOR_ADDRESS;

    private readonly cache = {};
    private readonly digit = 6;
    private readonly metricPrefix = 'tendermint';

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

    private readonly delegatedGauge = new Gauge({
        name: `${this.metricPrefix}_address_delegated`,
        help: 'Delegated balance of address',
        labelNames: ['address']
    });

    private readonly unbondingGauge = new Gauge({
        name: `${this.metricPrefix}_address_unbonding`,
        help: 'Unbonding balance of address',
        labelNames: ['address']
    });

    private readonly rewardsGauge = new Gauge({
        name: `${this.metricPrefix}_address_rewards`,
        help: 'Rewards of address',
        labelNames: ['address']
    });

    private readonly commissionGauge = new Gauge({
        name: `${this.metricPrefix}_address_commission`,
        help: 'Commission of address',
        labelNames: ['address']
    });

    private readonly rankGauge = new Gauge({
        name: `${this.metricPrefix}_validator_rank`,
        help: 'Rank of validators',
        labelNames: ['validator']
    });
    private readonly maxValidatorGauge = new Gauge({
        name: `${this.metricPrefix}_staking_parameters_max_validator_count`,
        help: 'Limitation of validators count',
    });
    private readonly proposalsGauge = new Gauge({
        name: `${this.metricPrefix}_gov_proposals_count`,
        help: 'Gov proposals count',
    });

    public constructor() {
        super();

        this.registry.registerMetric(this.balanceGauge);
        this.registry.registerMetric(this.availableGauge);
        this.registry.registerMetric(this.delegatedGauge);
        this.registry.registerMetric(this.unbondingGauge);
        this.registry.registerMetric(this.rewardsGauge);
        this.registry.registerMetric(this.commissionGauge);

        this.registry.registerMetric(this.rankGauge);
        this.registry.registerMetric(this.maxValidatorGauge);
        this.registry.registerMetric(this.proposalsGauge);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            await Promise.all([
                await this.updateAddressBalance(this.address),
                await this.updateRank(this.validatorAddress),
                await this.updateMaxValidator(),
                await this.updateProposalsCount()
            ]);

            customMetrics = this.registry.metrics();

        } catch (e) {
            console.error(e.message);
        }


        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    private async updateAddressBalance(address: string): Promise<void> {

        const balances = [
            {
                url: `${this.lcdUrl}/bank/balances/${address}`,
                selector: (json: any) => json.result.reduce((s: number, i: any) => s + i.amount, 0)
            },
            {
                url: `${this.lcdUrl}/staking/delegators/${address}/delegations`,
                selector: (json: any) => json.result.reduce((s: number, i: any) => s + i.balance.amount, 0)
            },
            {
                url: `${this.lcdUrl}/staking/delegators/${address}/unbonding_delegations`,
                selector: (json: any) => json.result.reduce((s: number, i: any) => s + i.balance.amount, 0)
            },
            {
                url: `${this.lcdUrl}/distribution/delegators/${address}/rewards`,
                selector: (json: any) => json.result.total.reduce((s: number, i: any) => s + i.amount, 0)
            },
            {
                url: `${this.lcdUrl}/distribution/validators/${this.validatorAddress}`,
                selector: (json: any) => {
                    const commissionTop = json.result.val_commission;
                    if ('commission' in commissionTop) {
                        return commissionTop.commission.reduce((s: number, i: any) => s + i.amount, 0)
                    } else {
                        return commissionTop.reduce((s: number, i: any) => s + i.amount, 0)
                    }

                }
            },
        ];

        const available = await this.getAmount(balances[0].url, balances[0].selector, this.digit);
        this.availableGauge.labels(address).set(available);

        const delegated = await this.getAmount(balances[1].url, balances[1].selector, this.digit);
        this.delegatedGauge.labels(address).set(delegated);

        const unbonding = await this.getAmount(balances[2].url, balances[2].selector, this.digit);
        this.unbondingGauge.labels(address).set(unbonding);

        const rewards = await this.getAmount(balances[3].url, balances[3].selector, this.digit);
        this.rewardsGauge.labels(address).set(rewards);

        const commission = await this.getAmount(balances[4].url, balances[4].selector, this.digit);
        this.commissionGauge.labels(address).set(commission);

        this.balanceGauge.labels(address).set(available + delegated + unbonding + rewards + commission);
    }

    private async getAmount(url: string, selector: (json: {}) => number, decimal: number): Promise<number> {
        return this.get(url, response => {
            return selector(response.data) / Math.pow(10, decimal);
        });
    }

    private async updateRank(validator: string): Promise<void> {
        const url = `${this.lcdUrl}/staking/validators?status=bonded&page=1&limit=128`;

        return this.get(url, response => {
            const sorted = _.sortBy(response.data.result, (o) => {
                return parseInt(o.tokens);
            }).reverse();

            const rank = _.findIndex(sorted, (o) => {
                return o.operator_address === validator;
            }) + 1;

            this.rankGauge.labels(validator).set(rank);
        });
    }

    private async updateMaxValidator(): Promise<void> {
        const url = `${this.lcdUrl}/staking/parameters`;

        return this.get(url, response => {
            const limit = response.data.result.max_validators;
            this.maxValidatorGauge.set(limit);
        });
    }

    private async updateProposalsCount(): Promise<void> {
        // aggr status's count
        const url = `${this.lcdUrl}/gov/proposals`;

        return this.get(url, response => {
            const count = response.data.result.length;
            this.proposalsGauge.set(count);
        });
    }

    // private async jsonToMetrics(url: string, metricPath: string): Promise<Gauge<string>[]> {
    //     return axios.get(url).then(response => {
    //         return Object.entries(response.data.result).map(([key, value]) => {
    //
    //             const gauge = new Gauge({
    //                 name: `${this.metricPrefix}_${metricPath}_${key}`,
    //                 help: key,
    //             });
    //             if (typeof (value) === "number") {
    //                 gauge.set(value);
    //             } else if (typeof (value) === "string") {
    //                 gauge.set(parseInt(value));
    //             }
    //
    //             return gauge;
    //         });
    //     });
    // }

    private async loadExistMetrics(): Promise<string> {
        return this.get(this.existMetricUrl, response => {
            return response.data;
        });
    }

    private async get(url: string, process: (response: { data: any }) => string | number | void) {
        return axios.get(url).then(response => {
            const result = process(response);
            this.cache[url] = result;
            return result;
        }).catch((e) => {
            console.error(e.message);

            const result = this.cache[url];
            if (result === undefined)
                return '';
            else
                return result;
        });
    }
}

