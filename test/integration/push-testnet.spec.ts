import nock from "nock";
import { register } from "prom-client";
import CosmosCollectorBase from "../../src/availables/shared/cosmos-base";
import PushTestnet from "../../src/availables/testnet/push";

describe("Push Chain testnet metrics contract", () => {
  const apiUrl = "http://127.0.0.1:1317";
  const rpcUrl = "http://127.0.0.1:26657";
  const referenceRpcUrl = "http://push-reference";
  const address = "push1address";
  const validator = "pushvaloper1validator";

  beforeEach(() => {
    nock.disableNetConnect();

    nock(apiUrl)
      .get(`/cosmos/bank/v1beta1/balances/${address}`)
      .reply(200, {
        balances: [{ denom: "upc", amount: "1230000000000000000" }],
      })
      .get(`/cosmos/auth/v1beta1/accounts/${address}`)
      .reply(200, { account: { sequence: "7" } })
      .get(`/cosmos/staking/v1beta1/delegations/${address}`)
      .reply(200, {
        delegation_responses: [{ balance: { denom: "upc", amount: "4560000000000000000" } }],
      })
      .get(`/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations`)
      .reply(200, {
        unbonding_responses: [{ entries: [{ balance: "780000000000000000" }] }],
      })
      .get(`/cosmos/distribution/v1beta1/delegators/${address}/rewards`)
      .reply(200, {
        rewards: [{ validator_address: validator, reward: [{ denom: "upc", amount: "1" }] }],
        total: [{ denom: "upc", amount: "120000000000000000" }],
      })
      .get(`/cosmos/distribution/v1beta1/validators/${validator}/commission`)
      .reply(200, {
        commission: { commission: [{ denom: "upc", amount: "340000000000000000" }] },
      })
      .get("/cosmos/staking/v1beta1/validators")
      .query({ status: "BOND_STATUS_BONDED", "pagination.limit": "256" })
      .reply(200, {
        validators: [
          { operator_address: "pushvaloper1rival", tokens: "9000000000000000000" },
          { operator_address: validator, tokens: "5000000000000000000" },
          { operator_address: "pushvaloper1below", tokens: "1000000000000000000" },
        ],
      })
      .get("/cosmos/staking/v1beta1/params")
      .reply(200, { params: { max_validators: 100 } })
      .get("/cosmos/gov/v1/proposals")
      .query({ proposal_status: "2" })
      .reply(200, { proposals: [{ id: "1" }] });

    nock(rpcUrl)
      .get("/validators")
      .query({ per_page: "100" })
      .reply(200, {
        result: {
          validators: [{ address: "ABC123", voting_power: "5" }],
        },
      })
      .get("/status")
      .reply(200, {
        result: {
          node_info: { network: "push_42101-1" },
          sync_info: { latest_block_height: "100", catching_up: false },
        },
      })
      .get("/net_info")
      .reply(200, { result: { n_peers: "4" } })
      .get("/block")
      .query({ height: "100" })
      .reply(200, { result: { block: { header: { app_hash: "ABCDEF" } } } });

    nock(referenceRpcUrl)
      .get("/status")
      .reply(200, {
        result: {
          node_info: { network: "push_42101-1" },
          sync_info: { latest_block_height: "100", catching_up: false },
        },
      })
      .get("/block")
      .query({ height: "100" })
      .reply(200, { result: { block: { header: { app_hash: "ABCDEF" } } } });
  });

  afterEach(() => {
    expect(nock.isDone()).toBe(true);
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("uses Push defaults and normalizes standard Cosmos v1 responses", async () => {
    const collector = new PushTestnet("", apiUrl, rpcUrl, address, validator, referenceRpcUrl);
    const metrics = await collector.makeMetrics();

    expect(metrics).toContain(
      `tendermint_address_available{address="${address}",denom="upc"} 1.23`,
    );
    expect(metrics).toContain(
      `tendermint_address_delegated{address="${address}",denom="upc"} 4.56`,
    );
    expect(metrics).toContain(
      `tendermint_address_unbonding{address="${address}",denom="upc"} 0.78`,
    );
    expect(metrics).toContain(`tendermint_address_rewards{address="${address}",denom="upc"} 0.12`);
    expect(metrics).toContain(
      `tendermint_address_commission{address="${validator}",denom="upc"} 0.34`,
    );
    expect(metrics).toContain(`tendermint_address_sequence{address="${address}"} 7`);
    expect(metrics).toContain('tendermint_validator_rank{validator="pushvaloper1validator"} 2');
    expect(metrics).toContain('tendermint_validators_power{address="ABC123"} 5');
    expect(metrics).toContain("push_validator_local_rpc_up 1");
    expect(metrics).toContain("push_validator_reference_rpc_up 1");
    expect(metrics).toContain("push_validator_catching_up 0");
    expect(metrics).toContain("push_validator_local_peers 4");
    expect(metrics).toContain("push_validator_local_height 100");
    expect(metrics).toContain("push_validator_reference_height 100");
    expect(metrics).toContain("push_validator_app_hash_comparable 1");
    expect(metrics).toContain("push_validator_app_hash_match 1");
  });

  it("keeps health metrics when the validator API is not ready", async () => {
    nock.cleanAll();
    register.clear();

    nock(apiUrl).get(/.*/).times(9).reply(500, { code: 3, message: "validator does not exist" });

    nock(rpcUrl)
      .get("/validators")
      .query({ per_page: "100" })
      .reply(200, { result: { validators: [] } })
      .get("/status")
      .reply(200, {
        result: {
          node_info: { network: "push_42101-1" },
          sync_info: { latest_block_height: "100", catching_up: false },
        },
      })
      .get("/net_info")
      .reply(200, { result: { n_peers: "4" } });

    nock(referenceRpcUrl).get("/status").reply(500, { code: 14, message: "reference unavailable" });

    const collector = new PushTestnet("", apiUrl, rpcUrl, address, validator, referenceRpcUrl);
    const metrics = await collector.makeMetrics();

    expect(metrics).toContain("push_validator_local_rpc_up 1");
    expect(metrics).toContain("push_validator_reference_rpc_up 0");
    expect(metrics).toContain("push_validator_app_hash_comparable 0");
    expect(metrics).not.toContain("push_validator_reference_height 0");
    expect(metrics).not.toContain("push_validator_app_hash_match 0");
    expect(metrics).not.toContain(`tendermint_address_commission{address="${validator}"`);
  });

  it("omits unknown health values when local RPC or reference is unconfigured", async () => {
    nock.cleanAll();
    register.clear();

    nock(apiUrl).get(/.*/).times(9).reply(500, { code: 3, message: "validator does not exist" });

    nock(rpcUrl)
      .get("/validators")
      .query({ per_page: "100" })
      .reply(200, { result: { validators: [] } })
      .get("/status")
      .reply(500, { code: 14, message: "local RPC unavailable" })
      .get("/net_info")
      .reply(500, { code: 14, message: "local RPC unavailable" });

    const collector = new PushTestnet("", apiUrl, rpcUrl, address, validator);
    const metrics = await collector.makeMetrics();

    expect(metrics).toContain("push_validator_local_rpc_up 0");
    expect(metrics).not.toContain("push_validator_local_height 0");
    expect(metrics).not.toContain("push_validator_catching_up 1");
    expect(metrics).not.toContain("push_validator_reference_rpc_up 0");
    expect(metrics).not.toContain("push_validator_reference_height 0");
    expect(metrics).not.toContain("push_validator_app_hash_comparable 0");
    expect(metrics).not.toContain("push_validator_app_hash_match 0");
  });

  it("keeps reverse-proxy path prefixes on health requests", async () => {
    nock.cleanAll();
    register.clear();

    nock(apiUrl)
      .get(`/cosmos/distribution/v1beta1/validators//commission`)
      .reply(200, { commission: { commission: [] } })
      .get("/cosmos/staking/v1beta1/validators")
      .query({ status: "BOND_STATUS_BONDED", "pagination.limit": "256" })
      .reply(200, { validators: [] })
      .get("/cosmos/staking/v1beta1/params")
      .reply(200, { params: { max_validators: 100 } })
      .get("/cosmos/gov/v1/proposals")
      .query({ proposal_status: "2" })
      .reply(200, { proposals: [] });

    const prefixedRpcUrl = `${rpcUrl}/push-rpc`;
    nock(rpcUrl)
      .get("/push-rpc/validators")
      .query({ per_page: "100" })
      .reply(200, { result: { validators: [] } })
      .get("/push-rpc/status")
      .reply(200, {
        result: {
          node_info: { network: "push_42101-1" },
          sync_info: { latest_block_height: "100", catching_up: false },
        },
      })
      .get("/push-rpc/net_info")
      .reply(200, { result: { n_peers: "4" } });

    const collector = new PushTestnet("", apiUrl, prefixedRpcUrl, "", "");
    const metrics = await collector.makeMetrics();

    expect(metrics).toContain("push_validator_local_rpc_up 1");
    expect(metrics).toContain("push_validator_local_height 100");
    expect(metrics).toContain("push_validator_local_peers 4");
  });

  it("returns health metrics when base collection does not settle", async () => {
    nock.cleanAll();
    register.clear();

    nock(rpcUrl)
      .get("/status")
      .reply(200, {
        result: {
          node_info: { network: "push_42101-1" },
          sync_info: { latest_block_height: "100", catching_up: false },
        },
      })
      .get("/net_info")
      .reply(200, { result: { n_peers: "4" } });

    const originalMakeMetrics = CosmosCollectorBase.prototype.makeMetrics;
    CosmosCollectorBase.prototype.makeMetrics = () => new Promise<string>(() => undefined);

    try {
      const collector = new PushTestnet("", apiUrl, rpcUrl, "", "");
      const metrics = await collector.makeMetrics();

      expect(metrics).toContain("push_validator_local_rpc_up 1");
      expect(metrics).toContain("push_validator_local_height 100");
    } finally {
      CosmosCollectorBase.prototype.makeMetrics = originalMakeMetrics;
    }
  });
});
