import TargetAbstract from "../target.abstract";
import {Gauge, Registry} from 'prom-client';
import * as _ from 'lodash';

export default class Solana extends TargetAbstract {


    private readonly digit = 9;
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
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, rpcUrl, addresses, validator);

        this.registry.registerMetric(this.balanceGauge);
        this.registry.registerMetric(this.availableGauge);
        this.registry.registerMetric(this.activatedStakeGauge);

        this.registry.registerMetric(this.activeGauge);
        this.registry.registerMetric(this.commissionGauge);
        // this.registry.registerMetric(this.rankGauge);

        // this.registry.registerMetric(this.rootSlotGauge);
        this.registry.registerMetric(this.lastVoteGauge);

        // this.registry.registerMetric(this.validatorsCount);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            await Promise.all([
                this.updateBalance(this.addresses),
                this.updateVoteAccounts(this.validator),
                // await this.updateRank(this.validator),
                // await this.updateMaxValidator(),
            ]);

            customMetrics = await this.registry.metrics();

        } catch (e) {
            console.error('makeMetrics', e);
        }


        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    private async updateBalance(addresses: string): Promise<void> {
        for(const address of addresses.split(',')) {
            const available = await this.getAmount(this.apiUrl, {
                method: 'getBalance',
                params: [address]
            }, (json: any) => json.result.value);
            this.availableGauge.labels(address).set(available);

            this.balanceGauge.labels(address).set(available);
        }
    }

    private async updateVoteAccounts(validator: string): Promise<void> {
        return this.postWithCache(this.apiUrl, {method: 'getVoteAccounts'}, response => {

            const validators = _.concat(response.data.result.current.map((i: any) => {
                i.status = 'current'
                return i;
            }), response.data.result.delinquent.map((i: any) => {
                i.status = 'delinquent'
                return i;
            }));

            const sorted = _.sortBy(validators, (i) => i.activatedStake).reverse();
            const myValidator = _.find(sorted, (o) => {
                return o.votePubkey === validator;
            });
            // const rank = _.findIndex(sorted, (o) => {
            //     return o.votePubkey === validator;
            // }) + 1;

            // const max = sorted.length;


            this.activatedStakeGauge.labels(validator).set(myValidator.activatedStake / Math.pow(10, this.digit));
            this.activeGauge.labels(validator).set(myValidator.status === 'current' ? 1 : 0);
            this.commissionGauge.labels(validator).set(myValidator.commission);
            // this.rankGauge.labels(validator).set(rank);
            // this.validatorsCount.set(max);
            // this.rootSlotGauge.labels(validator).set(myValidator.rootSlot);
            this.lastVoteGauge.labels(validator).set(myValidator.lastVote);
        });
    }

    private async getAmount(url: string, data: { method: string, params?: string[] }, selector: (json: {}) => number): Promise<number> {
        return this.postWithCache(url, data, response => {
            return selector(response.data) / Math.pow(10, this.digit);
        });
    }

}

