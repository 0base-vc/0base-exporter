import { readFileSync } from "node:fs";
import { join } from "node:path";
import nock from "nock";
import TendermintV1 from "../../src/availables/tendermint-v1";

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "fixtures", "tendermint-v1", `${name}.json`), "utf8"),
  );
}

describe("TendermintV1 metrics contract", () => {
  const apiUrl = "http://127.0.0.1:1317";
  const rpcUrl = "http://127.0.0.1:26657";
  const address = "cosmos1address";
  const validator = "cosmosvaloper1validator";

  beforeEach(() => {
    nock.disableNetConnect();

    nock(apiUrl)
      .get(`/cosmos/bank/v1beta1/balances/${address}`)
      .reply(200, loadFixture("balances"))
      .get(`/cosmos/staking/v1beta1/delegations/${address}`)
      .reply(200, loadFixture("delegations"))
      .get(`/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations`)
      .reply(200, loadFixture("unbonding"))
      .get(`/cosmos/distribution/v1beta1/delegators/${address}/rewards`)
      .reply(200, loadFixture("rewards"))
      .get(`/cosmos/distribution/v1beta1/validators/${validator}/commission`)
      .reply(200, loadFixture("commission"))
      .get("/cosmos/staking/v1beta1/validators")
      .query({ status: "BOND_STATUS_BONDED", "pagination.limit": "256" })
      .reply(200, loadFixture("validators"))
      .get("/cosmos/staking/v1beta1/params")
      .reply(200, loadFixture("params"))
      .get("/cosmos/gov/v1/proposals")
      .query({ proposal_status: "2" })
      .reply(200, loadFixture("proposals"));

    nock(rpcUrl)
      .get("/validators")
      .query({ per_page: "100" })
      .reply(200, loadFixture("rpc-validators"));
  });

  afterEach(() => {
    expect(nock.isDone()).toBe(true);
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("keeps the exported metric names and scaling stable", async () => {
    const collector = new TendermintV1("", apiUrl, rpcUrl, address, validator);
    const metrics = await collector.makeMetrics();

    expect(metrics).toMatchInlineSnapshot(`
"# HELP tendermint_address_available Available balance of address
# TYPE tendermint_address_available gauge
tendermint_address_available{address="cosmos1address",denom="uatom"} 1.23

# HELP tendermint_address_delegated Delegated balance of address
# TYPE tendermint_address_delegated gauge
tendermint_address_delegated{address="cosmos1address",denom="uatom"} 4.56

# HELP tendermint_address_unbonding Unbonding balance of address
# TYPE tendermint_address_unbonding gauge
tendermint_address_unbonding{address="cosmos1address",denom="undefined"} 0.78

# HELP tendermint_address_rewards Rewards of address
# TYPE tendermint_address_rewards gauge
tendermint_address_rewards{address="cosmos1address",denom="uatom"} 0.12

# HELP tendermint_address_commission Commission balance of address
# TYPE tendermint_address_commission gauge
tendermint_address_commission{address="cosmosvaloper1validator",denom="uatom"} 0.34

# HELP tendermint_validator_rank Your rank of validators
# TYPE tendermint_validator_rank gauge
tendermint_validator_rank{validator="cosmosvaloper1validator"} 2

# HELP tendermint_validator_power_rivals Voting power of Rivals
# TYPE tendermint_validator_power_rivals gauge
tendermint_validator_power_rivals{rank="above"} 9
tendermint_validator_power_rivals{rank="below"} 5

# HELP tendermint_staking_parameters_max_validator_count Limitation of validators count
# TYPE tendermint_staking_parameters_max_validator_count gauge
tendermint_staking_parameters_max_validator_count 180

# HELP tendermint_gov_proposals_count Gov voting period proposals count
# TYPE tendermint_gov_proposals_count gauge
tendermint_gov_proposals_count 2

# HELP tendermint_validators_power Validators power
# TYPE tendermint_validators_power gauge
tendermint_validators_power{address="A1B2C3"} 111
tendermint_validators_power{address="D4E5F6"} 222

"
`);
  });
});
