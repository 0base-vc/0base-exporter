import { Gauge, Registry, register } from "prom-client";
import {
  updateSolanaClusterRequiredVersions,
  updateSolanaVoteAccounts,
} from "../../src/availables/shared/solana-common";

type Selector = (response: { data: unknown }) => unknown;
type PostFn = (url: string, data: unknown, selector: Selector) => Promise<unknown>;

type VoteAccountsPostMock = PostFn & { calls: number };

function createGauge(name: string): Gauge<string> {
  return new Gauge({
    name,
    help: name,
    labelNames: ["vote"],
  });
}

describe("updateSolanaVoteAccounts", () => {
  beforeEach(() => {
    register.clear();
  });

  afterEach(() => {
    register.clear();
  });

  function createVoteAccountsPostMock(): VoteAccountsPostMock {
    const fn = (async (_url: string, _data: unknown, selector: Selector): Promise<unknown> => {
      fn.calls += 1;
      if (fn.calls === 1) {
        return selector({
          data: {
            result: {
              current: [
                {
                  votePubkey: "vote-1",
                  activatedStake: 123_000_000_000,
                  commission: 7,
                  lastVote: 42,
                  nodePubkey: "identity-1",
                },
              ],
              delinquent: [],
            },
          },
        });
      }

      return selector({
        data: {
          result: {
            current: [],
            delinquent: [
              {
                votePubkey: "vote-1",
                activatedStake: 123_000_000_000,
                commission: 7,
                lastVote: 43,
                nodePubkey: "identity-1",
              },
            ],
          },
        },
      });
    }) as VoteAccountsPostMock;

    fn.calls = 0;
    return fn;
  }

  it("refreshes vote-account liveness metrics on repeated scrapes", async () => {
    const registry = new Registry();
    const activatedStakeGauge = createGauge("test_solana_validator_activated_stake");
    const activeGauge = createGauge("test_solana_validator_active");
    const commissionGauge = createGauge("test_solana_validator_commission");
    const lastVoteGauge = createGauge("test_solana_validator_last_vote");
    registry.registerMetric(activatedStakeGauge);
    registry.registerMetric(activeGauge);
    registry.registerMetric(commissionGauge);
    registry.registerMetric(lastVoteGauge);

    const post = createVoteAccountsPostMock();

    const invoke = async () => {
      await updateSolanaVoteAccounts({
        validators: "vote-1",
        rpcUrl: "https://rpc.example",
        activatedStakeGauge,
        activeGauge,
        commissionGauge,
        lastVoteGauge,
        post,
      });
      return registry.metrics();
    };

    const firstMetrics = await invoke();
    const secondMetrics = await invoke();

    expect(post.calls).toBe(2);
    expect(firstMetrics).toContain('test_solana_validator_activated_stake{vote="vote-1"} 123');
    expect(firstMetrics).toContain('test_solana_validator_active{vote="vote-1"} 1');
    expect(firstMetrics).toContain('test_solana_validator_commission{vote="vote-1"} 7');
    expect(firstMetrics).toContain('test_solana_validator_last_vote{vote="vote-1"} 42');
    expect(secondMetrics).toContain('test_solana_validator_activated_stake{vote="vote-1"} 123');
    expect(secondMetrics).toContain('test_solana_validator_active{vote="vote-1"} 0');
    expect(secondMetrics).toContain('test_solana_validator_commission{vote="vote-1"} 7');
    expect(secondMetrics).toContain('test_solana_validator_last_vote{vote="vote-1"} 43');
  });
});

describe("updateSolanaClusterRequiredVersions", () => {
  beforeEach(() => {
    register.clear();
  });

  afterEach(() => {
    register.clear();
  });

  it("uses the Firedancer minimum version from the Solana API", async () => {
    const registry = new Registry();
    const clusterRequiredVersionGauge = new Gauge({
      name: "test_solana_cluster_required_versions",
      help: "cluster required versions",
      labelNames: ["min_version_agave", "min_version_firedancer"],
      registers: [registry],
    });

    const getWithCache = jest.fn(
      async (_url: string, selector: Selector): Promise<unknown> =>
        selector({
          data: {
            data: [
              {
                epoch: 800,
                agave_min_version: "2.2.0",
                firedancer_min_version: "0.1204.40300",
                firedancer_full_min_version: "26.8.5",
                frankendancer_min_version: "0.9.0",
              },
            ],
          },
        }),
    );

    await updateSolanaClusterRequiredVersions({
      cluster: "mainnet-beta",
      clusterRequiredVersionGauge,
      getWithCache,
    });

    const metrics = await registry.metrics();
    expect(metrics).toContain(
      'test_solana_cluster_required_versions{min_version_agave="2.2.0",min_version_firedancer="26.8.5"} 800',
    );
    expect(metrics).not.toContain('min_version_firedancer="0.1204.40300"');
    expect(metrics).not.toContain("min_version_frankendancer");
    expect(getWithCache).toHaveBeenCalledWith(
      "https://api.solana.org/api/community/v1/sfdp_required_versions?cluster=mainnet-beta",
      expect.any(Function),
      60000,
    );
  });
});
