import {Gauge} from 'prom-client';
import Tendermint from "./tendermint-v1beta1";

export default class Umee extends Tendermint {
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
        const url = `${this.apiUrl}/umee/oracle/v1/validators/${validator}/miss`;

        return this.get(url, response => {
            this.missedOracleGauge.set(parseInt(response.data.miss_counter));
        });
    }
}

