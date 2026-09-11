import nock from "nock";
import { register } from "prom-client";
import Limonata from "../../src/availables/testnet/limonata";
import { loadRuntimeConfig } from "../../src/core/config";

const API = "http://limo-api.example";
const RPC = "http://limo-rpc.example";
const account = "cosmos1operator";
const validator = "cosmosvaloper1operator";
function cosmos(mixed = false) {
  const root = "/cosmos";
  nock(API)
    .get(`${root}/bank/v1beta1/balances/${account}`)
    .reply(200, {
      balances: [
        { denom: "aLIMO", amount: "2000000000000000000" },
        ...(mixed ? [{ denom: "uatom", amount: "1000000" }] : []),
      ],
    });
  nock(API)
    .get(`${root}/staking/v1beta1/delegations/${account}`)
    .reply(200, {
      delegation_responses: [{ balance: { denom: "aLIMO", amount: "1000000000000000000" } }],
    });
  nock(API)
    .get(`${root}/staking/v1beta1/delegators/${account}/unbonding_delegations`)
    .reply(200, { unbonding_responses: [] });
  nock(API)
    .get(`${root}/distribution/v1beta1/delegators/${account}/rewards`)
    .reply(200, { total: [] });
  nock(API)
    .get(`${root}/auth/v1beta1/accounts/${account}`)
    .reply(200, { account: { base_account: { sequence: "3" } } });
  nock(API)
    .get(`${root}/distribution/v1beta1/validators/${validator}/commission`)
    .reply(200, { commission: { commission: [] } });
  nock(API)
    .get(`${root}/staking/v1beta1/validators`)
    .query(true)
    .reply(200, { validators: [{ operator_address: validator, tokens: "1000000000000000000" }] });
  nock(API)
    .get(`${root}/staking/v1beta1/params`)
    .reply(200, { params: { max_validators: 100 } });
  nock(API).get(`${root}/gov/v1/proposals`).query(true).reply(200, { proposals: [] });
}
function health(active = true) {
  nock(RPC)
    .get("/status")
    .reply(200, {
      result: {
        node_info: { network: "limonata_10777-1" },
        sync_info: {
          latest_block_height: "100",
          latest_block_time: "2026-09-11T00:00:00Z",
          catching_up: false,
        },
        validator_info: { voting_power: "1" },
      },
    });
  nock(RPC)
    .get("/net_info")
    .reply(200, { result: { n_peers: "4" } });
  nock(API)
    .get(`/cosmos/staking/v1beta1/validators/${validator}`)
    .reply(
      active ? 200 : 404,
      active
        ? {
            validator: {
              jailed: false,
              status: "BOND_STATUS_BONDED",
              tokens: "1000000000000000000",
            },
          }
        : {},
    );
}
const collector = (existing = "") => new Limonata(existing, API, RPC, account, validator);
describe("Limonata", () => {
  beforeAll(() => nock.disableNetConnect());
  beforeEach(() => register.clear());
  afterEach(() => {
    const done = nock.isDone();
    nock.abortPendingRequests();
    nock.cleanAll();
    expect(done).toBe(true);
  });
  afterAll(() => nock.enableNetConnect());
  it("registers new and legacy configuration", () => {
    for (const chain of [
      { CHAIN: "limonata-testnet" },
      { BLOCKCHAIN: "./availables/testnet/limonata.js" },
    ]) {
      expect(
        loadRuntimeConfig({
          ...chain,
          API_URL: API,
          RPC_URL: RPC,
          ADDRESS: account,
          VALIDATOR: validator,
        }).chainId,
      ).toBe("limonata-testnet");
    }
    expect(() => loadRuntimeConfig({ CHAIN: "limonata-testnet" })).toThrow();
  });
  it("reuses Cosmos metrics with fixed 18 decimals and appends native metrics", async () => {
    cosmos();
    health();
    nock("http://native.example").get("/metrics").reply(200, "cometbft_consensus_height 100\n");
    const out = await collector("http://native.example/metrics").makeMetrics();
    expect(out).toContain(`tendermint_address_available{address="${account}",denom="aLIMO"} 2`);
    expect(out).toContain("limonata_validator_tokens 1");
    expect(out).toContain("limonata_catching_up 0");
    expect(out).toContain("tendermint_consensus_height 100");
    expect(out).toContain("limonata_cosmos_up 1");
  });
  it("does not replay health or balances after a failed scrape", async () => {
    cosmos();
    health();
    const target = collector();
    await target.makeMetrics();
    nock(API).get(/.*/).times(5).reply(503);
    nock(RPC).get(/.*/).times(2).reply(503);
    const out = await target.makeMetrics();
    expect(out).toContain("limonata_rpc_up 0");
    expect(out).toContain("limonata_cosmos_up 0");
    expect(out).not.toContain("limonata_latest_block_height");
    expect(out).not.toContain(`tendermint_address_available{address="${account}"`);
  });
  it("represents an unregistered validator query as unavailable", async () => {
    cosmos();
    health(false);
    const out = await collector().makeMetrics();
    expect(out).toContain("limonata_validator_query_up 0");
    expect(out).not.toContain("limonata_validator_bonded");
  });
  it("does not apply aLIMO precision to other bank denominations", async () => {
    cosmos(true);
    health();
    const out = await collector().makeMetrics();
    expect(out).not.toContain('denom="uatom"');
  });
  it("keeps chain metrics available when optional native metrics fail", async () => {
    cosmos();
    health();
    nock("http://native.example").get("/metrics").reply(503);
    const out = await collector("http://native.example/metrics").makeMetrics();
    expect(out).toContain("limonata_rpc_up 1");
    expect(out).toContain("limonata_native_metrics_up 0");
  });
  it("retains successful native endpoints on partial failure", async () => {
    cosmos();
    health();
    nock("http://native.example").get("/good").reply(200, "cometbft_height 100\n");
    nock("http://native.example").get("/bad").reply(503);
    const out = await collector(
      "http://native.example/good,http://native.example/bad",
    ).makeMetrics();
    expect(out).toContain("tendermint_height 100");
    expect(out).toContain("limonata_native_metrics_up 0");
  });
  it("bounds serial Cosmos requests by one collection deadline", async () => {
    nock(API)
      .get(`/cosmos/bank/v1beta1/balances/${account}`)
      .delay(3000)
      .reply(200, { balances: [] });
    nock(API)
      .get(`/cosmos/staking/v1beta1/delegations/${account}`)
      .delay(3000)
      .reply(200, { delegation_responses: [] });
    nock(API)
      .get(/\/cosmos\/(staking\/v1beta1\/(validators|params)|gov\/v1\/proposals)/)
      .query(true)
      .times(4)
      .reply(503);
    nock(RPC).get(/.*/).times(2).reply(503);
    const target = collector();
    const start = Date.now();
    const out = await target.makeMetrics();
    expect(Date.now() - start).toBeLessThan(5000);
    expect(out).toContain("limonata_cosmos_up 0");
    expect(nock.isDone()).toBe(true);
    cosmos();
    health();
    expect(await target.makeMetrics()).toContain("limonata_cosmos_up 1");
  }, 10000);
  it("emits performance metadata once across repeated scrapes", async () => {
    const { enablePromClientGaugeTiming } = await import("../../src/lib/prom-perf");
    enablePromClientGaugeTiming();
    const target = collector();
    for (let i = 0; i < 2; i++) {
      cosmos();
      health();
      const out = await target.makeMetrics();
      expect(out.match(/^# HELP metric_set_duration_ms /gm)).toHaveLength(1);
      expect(out.match(/^# TYPE metric_set_duration_ms /gm)).toHaveLength(1);
    }
  });
  it("deduplicates concurrent scrapes", async () => {
    cosmos();
    health();
    const target = collector();
    const [a, b] = await Promise.all([target.makeMetrics(), target.makeMetrics()]);
    expect(a).toBe(b);
  });
});
