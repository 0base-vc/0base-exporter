import nock from "nock";
import Tendermint from "../../src/availables/tendermint";

describe("Tendermint legacy metrics contract", () => {
  const apiUrl = "http://127.0.0.1:1318";
  const address = "cosmos1legacy";
  const validator = "cosmosvaloper1legacy";

  beforeEach(() => {
    nock.disableNetConnect();

    nock(apiUrl)
      .get(`/bank/balances/${address}`)
      .reply(200, { result: [{ denom: "uatom", amount: "1230000" }] })
      .get(`/staking/delegators/${address}/delegations`)
      .reply(200, { result: [{ balance: { denom: "uatom", amount: "4560000" } }] })
      .get(`/staking/delegators/${address}/unbonding_delegations`)
      .reply(200, { result: [{ entries: [{ balance: "780000" }] }] })
      .get(`/distribution/delegators/${address}/rewards`)
      .reply(200, { result: { total: [{ denom: "uatom", amount: "120000" }] } })
      .get(`/distribution/validators/${validator}`)
      .reply(200, { result: { val_commission: [{ denom: "uatom", amount: "340000" }] } })
      .get("/staking/validators")
      .query({ status: "BOND_STATUS_BONDED", page: "1", limit: "256" })
      .reply(200, {
        result: [
          { operator_address: "cosmosvaloper1top", tokens: "9000000" },
          { operator_address: validator, tokens: "8000000" },
          { operator_address: "cosmosvaloper1bottom", tokens: "5000000" },
        ],
      })
      .get("/staking/parameters")
      .reply(200, { result: { max_validators: 180 } })
      .get("/gov/proposals")
      .query({ status: "voting_period" })
      .reply(200, { result: [{ id: "1" }, { id: "2" }] });
  });

  afterEach(() => {
    expect(nock.isDone()).toBe(true);
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("keeps legacy metric names and scaling stable", async () => {
    const collector = new Tendermint("", apiUrl, "http://unused-rpc", address, validator);
    const metrics = await collector.makeMetrics();

    expect(metrics).toContain(
      'tendermint_address_available{address="cosmos1legacy",denom="uatom"} 1.23',
    );
    expect(metrics).toContain(
      'tendermint_address_commission{address="cosmosvaloper1legacy",denom="uatom"} 0.34',
    );
    expect(metrics).toContain('tendermint_validator_rank{validator="cosmosvaloper1legacy"} 2');
    expect(metrics).toContain('tendermint_validator_power_rivals{rank="above"} 9');
    expect(metrics).toContain('tendermint_validator_power_rivals{rank="below"} 5');
    expect(metrics).toContain("tendermint_gov_proposals_count 2");
    expect(metrics).not.toContain("tendermint_validators_power");
  });
});
