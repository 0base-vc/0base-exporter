import Tendermint from "./tendermint-v1beta1";
import {Gauge} from "prom-client";
// import * as _ from "lodash";

export default class Terra extends Tendermint {
    private readonly missedOracleGauge = new Gauge({
        name: `${this.metricPrefix}_missed_oracle_count`,
        help: 'Missed oracle count',
    });

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly addresses: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, addresses, validator);

        this.registry.registerMetric(this.missedOracleGauge);
    }

    public async makeMetrics(): Promise<string> {
        await this.updateMissedOracle(this.validator);
        return await super.makeMetrics();
    }

    private async updateMissedOracle(validator: string): Promise<void> {
        const url = `${this.apiUrl}/terra/oracle/v1beta1/validators/${validator}/miss`;

        return this.get(url, response => {
            this.missedOracleGauge.set(parseInt(response.data.miss_counter));
        });
    }

    // protected async updateRank(validator: string): Promise<void> {
    //     const url = `${this.apiUrl}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=150`;
    //
    //     return this.get(url, response => {
    //         const sorted = _.sortBy(response.data.validators, (o) => {
    //             return parseInt(o.tokens);
    //         }).reverse();
    //
    //         const rank = _.findIndex(sorted, (o) => {
    //             return o.operator_address === validator;
    //         }) + 1;
    //
    //         this.rankGauge.labels(validator).set(rank);
    //     });
    // }
}