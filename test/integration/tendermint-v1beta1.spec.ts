import nock from "nock";
import TendermintV1beta1 from "../../src/availables/tendermint-v1beta1";

describe("Tendermint v1beta1 metrics contract", () => {
  const apiUrl = "http://127.0.0.1:1319";
  const address = "cosmos1beta";
  const validator = "cosmosvaloper1beta";

  beforeEach(() => {
    nock.disableNetConnect();

    nock(apiUrl)
      .get(`/cosmos/bank/v1beta1/balances/${address}`)
      .reply(200, { balances: [{ denom: "uatom", amount: "1230000" }] })
      .get(`/cosmos/staking/v1beta1/delegations/${address}`)
      .reply(200, {
        delegation_responses: [{ balance: { denom: "uatom", amount: "4560000" } }],
      })
      .get(`/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations`)
      .reply(200, {
        unbonding_responses: [{ entries: [{ balance: "780000" }] }],
      })
      .get(`/cosmos/distribution/v1beta1/delegators/${address}/rewards`)
      .reply(200, { rewards: { total: [{ denom: "uatom", amount: "120000" }] } })
      .get(`/cosmos/distribution/v1beta1/validators/${validator}/commission`)
      .reply(200, { commission: { commission: [{ denom: "uatom", amount: "340000" }] } })
      .get("/cosmos/staking/v1beta1/validators")
      .query({ status: "BOND_STATUS_BONDED", "pagination.limit": "256" })
      .reply(200, {
        validators: [
          { operator_address: "cosmosvaloper1top", tokens: "9000000" },
          { operator_address: validator, tokens: "8000000" },
          { operator_address: "cosmosvaloper1bottom", tokens: "5000000" },
        ],
      })
      .get("/cosmos/staking/v1beta1/params")
      .reply(200, { params: { max_validators: 180 } })
      .get("/cosmos/gov/v1beta1/proposals")
      .query({ proposal_status: "2" })
      .reply(200, { proposals: [{ id: "1" }, { id: "2" }] });
  });

  afterEach(() => {
    expect(nock.isDone()).toBe(true);
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("keeps the v1beta1 profile contract stable", async () => {
    const collector = new TendermintV1beta1("", apiUrl, "http://unused-rpc", address, validator);
    const metrics = await collector.makeMetrics();

    expect(metrics).toContain(
      'tendermint_address_available{address="cosmos1beta",denom="uatom"} 1.23',
    );
    expect(metrics).toContain(
      'tendermint_address_commission{address="cosmosvaloper1beta",denom="uatom"} 0.34',
    );
    expect(metrics).toContain('tendermint_validator_rank{validator="cosmosvaloper1beta"} 2');
    expect(metrics).toContain("tendermint_staking_parameters_max_validator_count 180");
    expect(metrics).toContain("tendermint_gov_proposals_count 2");
    expect(metrics).not.toContain("tendermint_validators_power");
  });
});
