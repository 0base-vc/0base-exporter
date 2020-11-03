import TargetAbstract from "../target.abstract";
import axios from 'axios';
import {Registry, Gauge} from 'prom-client';
import * as _ from 'lodash';

export default class Target extends TargetAbstract {
    private readonly existMetricUrl = process.env.METRIC_EXIST_URL;
    private readonly lcdUrl = process.env.METRIC_LCD_URL;
    private readonly address = process.env.METRIC_ADDRESS;
    private readonly validatorAddress = process.env.METRIC_VALIDATOR_ADDRESS;

    private readonly digit = 6;
    private readonly metricPrefix = 'tendermint';

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            const registry = new Registry();
            registry.registerMetric(await this.getAddressBalance(this.address));
            registry.registerMetric(await this.getRank(this.validatorAddress));

            const parameterMetrics = await this.jsonToMetrics(`${this.lcdUrl}/staking/parameters`, 'staking_parameters');
            parameterMetrics.forEach((metric) => {
                registry.registerMetric(metric);
            });

            const poolMetrics = await this.jsonToMetrics(`${this.lcdUrl}/staking/pool`, 'staking_pool');
            poolMetrics.forEach((metric) => {
                registry.registerMetric(metric);
            });

            registry.registerMetric(await this.getProposalsCount());
            customMetrics = registry.metrics();
        } catch (e) {
            console.error(e);
        }


        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    private async getAddressBalance(address: string): Promise<Gauge<string>> {
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
                    if('commission' in commissionTop) {
                        return commissionTop.commission.reduce((s: number, i: any) => s + i.amount, 0)
                    } else {
                        return commissionTop.reduce((s: number, i: any) => s + i.amount, 0)
                    }

                }
            },
        ];

        const balance = (await Promise.all(
                balances.map(i => this.getAmount(i.url, i.selector, this.digit)))
        ).reduce((s, i) => s + i, 0);

        const gauge = new Gauge({
            name: `${this.metricPrefix}_address_balance`,
            help: 'Total balance of address',
            labelNames: ['address']
        });

        gauge.labels(address).set(balance);

        return gauge;
    }

    private async getAmount(url: string, selector: (json: {}) => number, decimal: number): Promise<number> {
        return axios.get(url).then(response => {
            return selector(response.data) / Math.pow(10, decimal);
        });
    }

    private async getRank(validator: string): Promise<Gauge<string>> {
        const url = `${this.lcdUrl}/staking/validators?status=bonded&page=1&limit=128`;
        return axios.get(url).then(response => {
            const sorted = _.sortBy(response.data.result, (o) => {
                return parseInt(o.tokens);
            }).reverse();

            const rank = _.findIndex(sorted, (o) => {
                return o.operator_address === validator;
            }) + 1;

            const gauge = new Gauge({
                name: `${this.metricPrefix}_validator_rank`,
                help: 'Rank of validators',
                labelNames: ['validator']
            });

            gauge.labels(validator).set(rank);

            return gauge;
        });
    }

    private async getProposalsCount(): Promise<Gauge<string>> {
        // aggr status's count
        const url = `${this.lcdUrl}/gov/proposals`;
        return axios.get(url).then(response => {
            const count = response.data.result.length;
            const gauge = new Gauge({
                name: `${this.metricPrefix}_gov_proposals_count`,
                help: 'Gov proposals count'
            });

            gauge.set(count);

            return gauge;
        });
    }

    private async jsonToMetrics(url: string, metricPath: string): Promise<Gauge<string>[]> {
        return axios.get(url).then(response => {
            return Object.entries(response.data.result).map(([key, value]) => {

                const gauge = new Gauge({
                    name: `${this.metricPrefix}_${metricPath}_${key}`,
                    help: key,
                });
                if (typeof (value) === "number") {
                    gauge.set(value);
                } else if (typeof (value) === "string") {
                    gauge.set(parseInt(value));
                }

                return gauge;
            });
        });
    }

    private async loadExistMetrics(): Promise<string> {
        return axios.get(this.existMetricUrl).then(response => {
            return response.data;
        }).catch((e) => {
            console.error(e);
            return ''
        });
    }
}

