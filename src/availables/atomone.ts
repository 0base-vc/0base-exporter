import Tendermint from "./tendermint-v1";

export default class AtomOne extends Tendermint {

    protected async updateProposalsCount(): Promise<void> {
        const url = `${this.apiUrl}/atomone/gov/v1/proposals?proposal_status=2`;

        return this.get(url, response => {
            const count = response.data.proposals.length;
            this.proposalsGauge.set(count);
        });
    }
}
