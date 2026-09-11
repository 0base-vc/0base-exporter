import nock from "nock";
import Hashkinetics from "../../src/availables/testnet/hashkinetics";
import { loadRuntimeConfig } from "../../src/core/config";

const LOCAL = "http://hashkinetics-local.example";
const REFERENCE = "http://hashkinetics-reference.example";
const ROOT = "ab".repeat(48);
const chain = {
  chain_id: "hashkinetics-1",
  genesis_digest: "genesis",
  app_hash: "local-state",
  node_version: "v0.19.0",
  height: 100,
  peers: 3,
  process: { rss_bytes: 1000, uptime_secs: 30, verifier_init_ms: 200 },
  signer: { remaining: 6000, capacity: 32768, epoch: 4 },
};
const set = {
  total_power: 18,
  quorum_power: 13,
  validators: [{ root_pk: ROOT, address: "rotating-address", voting_power: 1, epoch: 4 }],
};
function rpc(url: string, method: string, result: unknown, params: Record<string, number> = {}) {
  return nock(url).post("/", { jsonrpc: "2.0", id: 1, method, params }).reply(200, { result });
}
function local(info: unknown = chain, validators: unknown = set) {
  rpc(LOCAL, "hk_chainInfo", info);
  rpc(LOCAL, "hk_getValidators", validators);
}
function collector(reference = REFERENCE, validator = ROOT) {
  return new Hashkinetics("", reference, LOCAL, "", validator);
}

describe("Hashkinetics collector", () => {
  beforeAll(() => nock.disableNetConnect());
  afterEach(() => {
    expect(nock.isDone()).toBe(true);
    nock.cleanAll();
    jest.restoreAllMocks();
  });
  afterAll(() => nock.enableNetConnect());

  it("registers CHAIN and the legacy runtime path", () => {
    for (const env of [
      { CHAIN: "hashkinetics-testnet" },
      { BLOCKCHAIN: "./availables/testnet/hashkinetics.js" },
    ]) {
      expect(loadRuntimeConfig({ ...env, RPC_URL: LOCAL }).chainId).toBe("hashkinetics-testnet");
    }
    expect(() => loadRuntimeConfig({ CHAIN: "hashkinetics-testnet" })).toThrow("RPC_URL");
    expect(() => collector("", "private-key-or-address")).toThrow("public root_pk");
  });
  it("reports signer budget, local set membership, reference lag and same-height hash", async () => {
    local();
    rpc(REFERENCE, "hk_chainInfo", { ...chain, height: 150, app_hash: "reference-tip" });
    rpc(
      REFERENCE,
      "hk_getBlock",
      { found: true, height: 101, parent_app_hash: chain.app_hash },
      { height: 101 },
    );
    const result = await collector().makeMetrics();
    for (const sample of [
      "rpc_up 1",
      "peer_count 3",
      "latest_block_height 100",
      "reference_block_height 150",
      "sync_lag_blocks 50",
      "catching_up 1",
      "validator_active 1",
      "validator_voting_power 1",
      "signer_remaining 6000",
      "signer_epoch 4",
      "node_rss_bytes 1000",
      "app_hash_match 1",
      "quorum_power 13",
    ]) {
      expect(result).toContain(`hashkinetics_${sample}`);
    }
    expect(result).not.toContain("latest_block_time"); // RPC block timestamps are synthetic.
  });
  it("reports an observer without inventing a signing epoch in the validator set", async () => {
    local(chain, { ...set, validators: [] });
    const result = await collector("").makeMetrics();
    expect(result).toContain("hashkinetics_validator_active 0");
    expect(result).not.toContain("hashkinetics_validator_epoch");
    expect(result).not.toContain("hashkinetics_catching_up");
  });
  it("tracks membership by stable public root across operational-key rotations", async () => {
    local(chain, {
      ...set,
      validators: [{ ...set.validators[0], address: "new-address", epoch: 5 }],
    });
    expect(await collector("").makeMetrics()).toContain("hashkinetics_validator_epoch 5");
  });
  it("does not reuse cached successes or stale samples after RPC failures", async () => {
    const target = collector("");
    local();
    await target.makeMetrics();
    nock(LOCAL)
      .post("/", (b) => b.method === "hk_chainInfo")
      .reply(503);
    nock(LOCAL)
      .post("/", (b) => b.method === "hk_getValidators")
      .reply(200, { error: "unavailable" });
    const result = await target.makeMetrics();
    expect(result).toContain("hashkinetics_rpc_up 0");
    expect(result).toContain("hashkinetics_validator_query_up 0");
    expect(result).not.toContain("hashkinetics_latest_block_height");
    expect(result).not.toContain("hashkinetics_validator_active");
  });
  it("does not use local data as reference fallback when the reference fails", async () => {
    local();
    nock(REFERENCE).post("/").reply(503);
    const result = await collector().makeMetrics();
    expect(result).toContain("hashkinetics_reference_rpc_up 0");
    expect(result).not.toContain("hashkinetics_sync_lag_blocks");
  });
  it("rejects cross-network comparisons", async () => {
    local();
    rpc(REFERENCE, "hk_chainInfo", { ...chain, genesis_digest: "other" });
    const result = await collector().makeMetrics();
    expect(result).toContain("hashkinetics_reference_network_match 0");
    expect(result).not.toContain("hashkinetics_app_hash_match");
  });
  it("reports unavailable blocks separately from a real state mismatch", async () => {
    local();
    rpc(REFERENCE, "hk_chainInfo", { ...chain, height: 150 });
    rpc(REFERENCE, "hk_getBlock", { found: false }, { height: 101 });
    let result = await collector().makeMetrics();
    expect(result).toContain("hashkinetics_app_hash_check_up 0");
    expect(result).not.toContain("hashkinetics_app_hash_match");
    local();
    rpc(REFERENCE, "hk_chainInfo", { ...chain, app_hash: "different" });
    result = await collector().makeMetrics();
    expect(result).toContain("hashkinetics_app_hash_match 0");
  });
  it("compares a lagging reference at its own height", async () => {
    local();
    rpc(REFERENCE, "hk_chainInfo", { ...chain, height: 90, app_hash: "old-state" });
    rpc(
      LOCAL,
      "hk_getBlock",
      { found: true, height: 91, parent_app_hash: "old-state" },
      { height: 91 },
    );
    const result = await collector().makeMetrics();
    expect(result).toContain("hashkinetics_sync_lag_blocks 0");
    expect(result).toContain("hashkinetics_app_hash_match 1");
  });
  it("preserves progress observation time on a stalled chain and deduplicates scrapes", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(100000);
    const target = collector("");
    local();
    const [first, second] = await Promise.all([target.makeMetrics(), target.makeMetrics()]);
    expect(first).toBe(second);
    expect(first).toContain("hashkinetics_last_progress_time_seconds 100");
    now.mockReturnValue(130000);
    local();
    expect(await target.makeMetrics()).toContain("hashkinetics_last_progress_time_seconds 100");
    now.mockReturnValue(150000);
    local({ ...chain, height: 101 });
    expect(await target.makeMetrics()).toContain("hashkinetics_last_progress_time_seconds 150");
  });
  it("rejects malformed required fields and omits absent process data", async () => {
    local({ ...chain, height: null }, { validators: "bad" });
    expect(await collector("").makeMetrics()).toContain("hashkinetics_rpc_up 0");
    local({ ...chain, process: { rss_bytes: null }, signer: { ...chain.signer, remaining: -1 } });
    const result = await collector("").makeMetrics();
    expect(result).not.toContain("hashkinetics_node_rss_bytes");
    expect(result).not.toContain("hashkinetics_signer_remaining");
  });
});
