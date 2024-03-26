import Tendermint from "./tendermint";
import * as _ from "lodash";

export default class Terra extends Tendermint {

    protected async updateMaxValidator(): Promise<void> {
        const url = `${this.apiUrl}/cosmos/staking/v1beta1/params`;

        return this.get(url, response => {
            const limit = response.data.params.max_validators;
            this.maxValidatorGauge.set(limit);
        });
    }

    protected async updateAddressBalance(addresses: string): Promise<void> {
        for(const address of addresses.split(',')) {
            const balances = [
                {
                    url: `${this.apiUrl}/cosmos/bank/v1beta1/balances/${address}`,
                    selector: (json: any) => json.balances
                },
                {
                    url: `${this.apiUrl}/cosmos/staking/v1beta1/delegations/${address}`,
                    selector: (json: any) => json.delegation_responses.length === 0 ? [] : [json.delegation_responses.reduce((s: any, i: any) => {
                        s.amount = s.amount + parseInt(i.balance.amount);
                        return s;
                    }, {
                        denom: json.delegation_responses[0].balance.denom,
                        amount: 0
                    })]
                },
                {
                    url: `${this.apiUrl}/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations`,
                    selector: (json: any) => json.unbonding_responses.length === 0 ? [] : [json.unbonding_responses.reduce((s: any, i: any) => {
                        s.amount = s.amount + i.entries.reduce((s: any, j: any) => {
                            s = s + parseInt(j.balance);
                            return s;
                        }, 0);
                        return s;
                    }, {
                        amount: 0
                    })]
                },
                {
                    url: `${this.apiUrl}/cosmos/distribution/v1beta1/delegators/${address}/rewards`,
                    selector: (json: any) => json.rewards.total == null || json.rewards.total.length === 0 ? [] : json.rewards.total
                },
                {
                    url: `${this.apiUrl}/cosmos/distribution/v1beta1/validators/${this.validator}/commission`,
                    selector: (json: any) => json.commission.commission == null || json.commission.commission.length === 0 ? [] : json.commission.commission
                },
            ];

            const availables = await this.getAmount(balances[0].url, balances[0].selector, this.decimalPlaces);
            availables.forEach((available) => {
                this.availableGauge.labels(address, available.denom).set(available.amount);
            });

            const delegations = await this.getAmount(balances[1].url, balances[1].selector, this.decimalPlaces);
            delegations.forEach((delegation) => {
                this.delegatedGauge.labels(address, delegation.denom).set(delegation.amount);
            });

            const unbondings = await this.getAmount(balances[2].url, balances[2].selector, this.decimalPlaces);
            unbondings.forEach((unbonding) => {
                this.unbondingGauge.labels(address, unbonding.denom).set(unbonding.amount);
            });

            const rewards = await this.getAmount(balances[3].url, balances[3].selector, this.decimalPlaces);
            rewards.forEach((reward) => {
                this.rewardsGauge.labels(address, reward.denom).set(reward.amount);
            });

            const commissions = await this.getAmount(balances[4].url, balances[4].selector, this.decimalPlaces);
            commissions.forEach((commission) => {
                this.commissionGauge.labels(address, commission.denom).set(commission.amount);
            });
        }
    }

    protected async updateProposalsCount(): Promise<void> {
        const url = `${this.apiUrl}/cosmos/gov/v1beta1/proposals?proposal_status=2`;

        return this.get(url, response => {
            const count = response.data.proposals.length;
            this.proposalsGauge.set(count);
        });
    }

    protected async updateRank(validator: string): Promise<void> {
        const url = `${this.apiUrl}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=150`;

        return this.get(url, response => {
            const sorted = _.sortBy(response.data.validators, (o) => {
                return parseInt(o.tokens);
            }).reverse();

            const rank = _.findIndex(sorted, (o) => {
                return o.operator_address === validator;
            }) + 1;

            this.rankGauge.labels(validator).set(rank);
        });
    }
}