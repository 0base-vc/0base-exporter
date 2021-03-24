import Tendermint from "./tendermint";
import {Gauge} from "prom-client";
import * as _ from "lodash";

export default class Terra extends Tendermint {
    private readonly missedOracleGauge = new Gauge({
        name: `${this.metricPrefix}_missed_oracle_count`,
        help: 'Missed oracle count',
    });

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly address: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, address, validator);

        this.registry.registerMetric(this.missedOracleGauge);
    }

    public async makeMetrics(): Promise<string> {
        await this.updateMissedOracle(this.validator);
        return await super.makeMetrics();
    }

    private async updateMissedOracle(validator: string): Promise<void> {
        const url = `${this.apiUrl}/oracle/voters/${validator}/miss`;

        return this.get(url, response => {
            this.missedOracleGauge.set(parseInt(response.data.result));
        });
    }

    protected async updateRank(validator: string): Promise<void> {
        const url = `${this.apiUrl}/staking/validators?status=BONDED&?status=BONDED&page=1&limit=128`;

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
}