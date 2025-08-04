import TargetAbstract from "../../target.abstract";
import { Gauge, Registry } from 'prom-client';
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

    private readonly validatorBondsGauge = new Gauge({
        name: `${this.metricPrefix}_validator_bonds`,
        help: 'Your validator bonds',
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

    private readonly onboardingPriorityGauge = new Gauge({
        name: `${this.metricPrefix}_onboarding_priority`,
        help: 'Validator onboarding priority number',
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
        this.registry.registerMetric(this.onboardingPriorityGauge);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            await Promise.all([
                this.updateBalance(this.addresses),
                this.updateVoteAccounts(this.validators),
                this.updateOnboardingPriority(this.validators),
            ]);

            customMetrics = await this.registry.metrics();

        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    private async updateBalance(addresses: string): Promise<void> {
        for (const address of addresses.split(',')) {
            const available = await this.getAmount(this.apiUrl, {
                method: 'getBalance',
                params: [address]
            }, (json: any) => json.result.value);
            this.availableGauge.labels(address).set(available);

            this.balanceGauge.labels(address).set(available);

            // validator bonds
            const validatorBonds = await this.getValidatorBonds(address);
            if (validatorBonds) {
                this.validatorBondsGauge.labels(address).set(validatorBonds);
            }
        }
    }

    private async getValidatorBonds(voteAccount: string): Promise<number | undefined> {
        const arr = await this.getWithCache('https://validator-bonds-api.marinade.finance/bonds', (response: { data: any }) => {
            return response.data.bonds;
        });

        // vote_account와 일치하는 객체 찾기
        const found = Array.isArray(arr)
            ? arr.find((item: any) => item.vote_account === voteAccount)
            : undefined;
        // 값이 있으면 effective_amount / 1e9 반환
        return found ? found.effective_amount / 1e9 : undefined;
    }

    private async updateVoteAccounts(validators: string): Promise<void> {
        for (const validator of validators.split(',')) {
            await this.postWithCache(this.apiUrl, { method: 'getVoteAccounts' }, response => {

                const allValidators = _.concat(response.data.result.current.map((i: any) => {
                    i.status = 'current'
                    return i;
                }), response.data.result.delinquent.map((i: any) => {
                    i.status = 'delinquent'
                    return i;
                }));

                const myValidator = _.find(allValidators, (o: any) => {
                    return o.votePubkey === validator;
                });

                this.activatedStakeGauge.labels(validator).set(myValidator.activatedStake / Math.pow(10, this.digit));
                this.activeGauge.labels(validator).set(myValidator.status === 'current' ? 1 : 0);
                this.commissionGauge.labels(validator).set(myValidator.commission);
                this.lastVoteGauge.labels(validator).set(myValidator.lastVote);
            });
        }
    }

    private async getAmount(url: string, data: { method: string, params?: string[] }, selector: (json: {}) => number): Promise<number> {
        return this.postWithCache(url, data, response => {
            return selector(response.data) / Math.pow(10, this.digit);
        });
    }

    private async updateOnboardingPriority(validators: string): Promise<void> {
        for (const validator of validators.split(',')) {
            try {
                const onboardingData = await this.getWithCache(
                    `https://api.solana.org/api/validators/${validator}?cacheStatus=enable`,
                    (response: { data: any }) => response.data
                );

                if (onboardingData && onboardingData.onboardingNumber !== null && onboardingData.onboardingNumber !== undefined) {
                    this.onboardingPriorityGauge.labels(validator).set(onboardingData.onboardingNumber);
                }
            } catch (e) {
                console.error(`Failed to get onboarding priority for validator ${validator}:`, e);
            }
        }
    }

}