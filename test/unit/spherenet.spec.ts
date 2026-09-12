import nock from "nock";
import { register } from "prom-client";
import { loadRuntimeConfig } from "../../src/core/config";
import SphereNet from "../../src/availables/testnet/spherenet";

const RPC = "http://spherenet-rpc.example";
const GENESIS = "9ZbRXYQ8kxmaWddozFNxu7dtV6KmfVbfXXQFaQQn8CLH";
const VOTE = "Vote111111111111111111111111111111111111111";
const IDENTITY = "Identity1111111111111111111111111111111111";

function rpc(method: string, result: unknown) {
  return nock(RPC)
    .post("/", (body: { method?: string }) => body.method === method)
    .reply(200, { jsonrpc: "2.0", id: 1, result });
}

function successfulRpc() {
  rpc("getHealth", "ok");
  rpc("getSlot", 123456);
  rpc("getEpochInfo", { epoch: 24, slotIndex: 456, slotsInEpoch: 432000 });
  rpc("getIdentity", { identity: IDENTITY });
  rpc("getVersion", { "solana-core": "4.1.2", snVersion: "0.4.0", "feature-set": 2294970548 });
  rpc("getGenesisHash", GENESIS);
  rpc("getClusterNodes", [
    { pubkey: IDENTITY, gossip: "84.32.71.22:8001", shredVersion: 30454 },
    { pubkey: "peer-2", gossip: "84.32.32.7:8001", shredVersion: 30454 },
  ]);
  rpc("getVoteAccounts", {
    current: [
      {
        votePubkey: VOTE,
        nodePubkey: IDENTITY,
        activatedStake: 10000000000000,
        commission: 100,
        lastVote: 123450,
      },
    ],
    delinquent: [],
  });
}

function collector() {
  return new SphereNet("", "", RPC, VOTE, IDENTITY, GENESIS, "30454");
}

describe("SphereNet collector", () => {
  beforeAll(() => nock.disableNetConnect());
  beforeEach(() => register.clear());
  afterEach(() => {
    const completed = nock.isDone();
    nock.cleanAll();
    register.clear();
    expect(completed).toBe(true);
  });
  afterAll(() => nock.enableNetConnect());

  it("registers the CHAIN and legacy runtime selectors", () => {
    expect(
      loadRuntimeConfig({
        CHAIN: "spherenet-testnet",
        RPC_URL: RPC,
        VOTE,
        IDENTITY,
      }).chainId,
    ).toBe("spherenet-testnet");
    expect(
      loadRuntimeConfig({
        BLOCKCHAIN: "./availables/testnet/spherenet.js",
        RPC_URL: RPC,
        VOTE,
        IDENTITY,
      }).chainId,
    ).toBe("spherenet-testnet");
    expect(
      loadRuntimeConfig({
        CHAIN: "spherenet-testnet",
        RPC_URL: RPC,
        VOTE,
      }).collectorValidator,
    ).toBe("");
    expect(() => loadRuntimeConfig({ CHAIN: "spherenet-testnet", VOTE, IDENTITY })).toThrow(
      "RPC_URL",
    );
  });

  it("rejects an invalid configured shred version", () => {
    expect(() => new SphereNet("", "", RPC, VOTE, IDENTITY, GENESIS, "30454.5")).toThrow(
      "SHRED_VERSION",
    );
    register.clear();
    expect(() => new SphereNet("", "", RPC, VOTE, IDENTITY, GENESIS, "not-a-number")).toThrow(
      "SHRED_VERSION",
    );
  });

  it("reports only values returned by SphereNet's own RPC", async () => {
    successfulRpc();

    const result = await collector().makeMetrics();

    for (const sample of [
      "spherenet_rpc_up 1",
      "spherenet_slot 123456",
      "spherenet_epoch 24",
      "spherenet_cluster_node_count 2",
      "spherenet_validator_count 1",
      `spherenet_validator_active{vote="${VOTE}"} 1`,
      `spherenet_validator_activated_stake_sphr{vote="${VOTE}"} 10000`,
      `spherenet_validator_commission_percent{vote="${VOTE}"} 100`,
      `spherenet_validator_last_vote{vote="${VOTE}"} 123450`,
      `spherenet_genesis_match 1`,
      "spherenet_shred_version 30454",
      "spherenet_shred_version_match 1",
    ]) {
      expect(result).toContain(sample);
    }
    expect(result).toContain(`spherenet_version_info{solana_core="4.1.2",sphere_version="0.4.0"`);
    expect(result).not.toContain("whoearns.live");
  });

  it("does not reuse a previous health result after the RPC fails", async () => {
    successfulRpc();
    const target = collector();
    await target.makeMetrics();

    nock(RPC)
      .post("/", (body: { method?: string }) => typeof body.method === "string")
      .times(8)
      .reply(503);
    const result = await target.makeMetrics();

    expect(result).toContain("spherenet_rpc_up 0");
    expect(result).toContain("spherenet_vote_accounts_up 0");
    expect(result).not.toContain("spherenet_slot 123456");
    expect(result).not.toContain(`spherenet_validator_active{vote="${VOTE}"}`);
  });

  it("does not turn nullable shred versions into zero", async () => {
    rpc("getHealth", "ok");
    rpc("getSlot", 123456);
    rpc("getEpochInfo", { epoch: 24 });
    rpc("getIdentity", { identity: IDENTITY });
    rpc("getVersion", { "solana-core": "4.1.2" });
    rpc("getGenesisHash", GENESIS);
    rpc("getClusterNodes", [
      { pubkey: IDENTITY, shredVersion: null },
      { pubkey: "peer-2", shredVersion: 30454 },
    ]);
    rpc("getVoteAccounts", { current: [], delinquent: [] });

    const result = await collector().makeMetrics();

    expect(result).toContain("spherenet_shred_version 30454");
    expect(result).not.toContain("spherenet_shred_version 0");
  });

  it("marks malformed vote-account payloads unavailable", async () => {
    rpc("getHealth", "ok");
    rpc("getSlot", 123456);
    rpc("getEpochInfo", { epoch: 24 });
    rpc("getIdentity", { identity: IDENTITY });
    rpc("getVersion", { "solana-core": "4.1.2" });
    rpc("getGenesisHash", GENESIS);
    rpc("getClusterNodes", []);
    rpc("getVoteAccounts", {});

    const result = await collector().makeMetrics();

    expect(result).toContain("spherenet_vote_accounts_up 0");
    expect(result).not.toContain(`spherenet_validator_active{vote="${VOTE}"}`);
  });

  it("rejects vote-account entries without identity and metric fields", async () => {
    rpc("getHealth", "ok");
    rpc("getSlot", 123456);
    rpc("getEpochInfo", { epoch: 24 });
    rpc("getIdentity", { identity: IDENTITY });
    rpc("getVersion", { "solana-core": "4.1.2" });
    rpc("getGenesisHash", GENESIS);
    rpc("getClusterNodes", []);
    rpc("getVoteAccounts", {
      current: [{ votePubkey: VOTE, activatedStake: "not-a-number" }],
      delinquent: [],
    });

    const result = await collector().makeMetrics();

    expect(result).toContain("spherenet_vote_accounts_up 0");
    expect(result).toContain("spherenet_validator_count 0");
    expect(result).not.toContain(`spherenet_validator_active{vote="${VOTE}"}`);
  });
});
