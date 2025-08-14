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
        for (const address of this.toUniqueList(addresses)) {
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
        const voteAccounts = this.toUniqueList(validators);
        await this.postWithCache(this.apiUrl, { method: 'getVoteAccounts' }, response => {

            const allValidators = _.concat(response.data.result.current.map((i: any) => {
                i.status = 'current'
                return i;
            }), response.data.result.delinquent.map((i: any) => {
                i.status = 'delinquent'
                return i;
            }));

            for (const validator of voteAccounts) {
                const myValidator = _.find(allValidators, (o: any) => {
                    return o.votePubkey === validator;
                });
                if (!myValidator) continue;

                this.activatedStakeGauge.labels(validator).set(myValidator.activatedStake / Solana.LAMPORTS_PER_SOL);
                this.activeGauge.labels(validator).set(myValidator.status === 'current' ? 1 : 0);
                this.commissionGauge.labels(validator).set(myValidator.commission);
                this.lastVoteGauge.labels(validator).set(myValidator.lastVote);
            }
        });
    }

    private async getAmount(url: string, data: { method: string, params?: string[] }, selector: (json: {}) => number): Promise<number> {
        return this.postWithCache(url, data, response => {
            return selector(response.data) / Solana.LAMPORTS_PER_SOL;
        });
    }

    private async updateOnboardingPriority(validators: string): Promise<void> {
        const voteAccounts = this.toUniqueList(validators);

        // 첫 실행 전: 실패한 주소 제외, 성공/실패를 판별해 집합에 기록
        // 첫 실행 이후(locked): 최초 성공한 주소만 계속 조회
        const targets: string[] = this.onboardingSelectionLocked
            ? voteAccounts.filter(v => this.onboardingAllowedValidators.has(v))
            : voteAccounts.filter(v => !this.onboardingFailedValidators.has(v));

        await Promise.all(targets.map(async (validator) => {
            try {
                const onboardingData = await this.getWithCache(
                    `https://api.solana.org/api/validators/${validator}?cacheStatus=enable`,
                    (response: { data: any }) => response.data
                );

                const hasValue = onboardingData && onboardingData.onboardingNumber !== null && onboardingData.onboardingNumber !== undefined;
                if (hasValue) {
                    this.onboardingPriorityGauge.labels(validator).set(onboardingData.onboardingNumber);
                    if (!this.onboardingSelectionLocked) {
                        this.onboardingAllowedValidators.add(validator);
                    }
                } else if (!this.onboardingSelectionLocked) {
                    this.onboardingFailedValidators.add(validator);
                }
            } catch (e) {
                if (!this.onboardingSelectionLocked) {
                    this.onboardingFailedValidators.add(validator);
                }
                console.error(`Failed to get onboarding priority for validator ${validator}:`, e);
            }
        }));

        // 첫 패스 이후엔 성공한 주소만 계속 확인하도록 고정
        if (!this.onboardingSelectionLocked) {
            this.onboardingSelectionLocked = true;
        }
    }

}