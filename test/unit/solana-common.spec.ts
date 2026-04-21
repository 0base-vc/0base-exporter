import { Gauge, Registry, register } from "prom-client";
import { updateSolanaVoteAccounts } from "../../src/availables/shared/solana-common";

type Selector = (response: { data: unknown }) => unknown;
type PostWithCacheFn = (
  url: string,
  data: unknown,
  selector: Selector,
  cacheDurationMs?: number,
  timeoutMs?: number,
) => Promise<unknown>;

type CachedVoteAccountsMock = PostWithCacheFn & { calls: number };

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

  function createCachedVoteAccountsMock(): CachedVoteAccountsMock {
    let cached: unknown;

    const fn = (async (_url: string, _data: unknown, selector: Selector): Promise<unknown> => {
      fn.calls += 1;
      if (fn.calls === 1) {
        cached = selector({
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

      return cached;
    }) as CachedVoteAccountsMock;

    fn.calls = 0;
    return fn;
  }

  it("re-emits cached vote-account metrics on repeated scrapes", async () => {
    const registry = new Registry();
    const activatedStakeGauge = createGauge("test_solana_validator_activated_stake");
    const activeGauge = createGauge("test_solana_validator_active");
    const commissionGauge = createGauge("test_solana_validator_commission");
    const lastVoteGauge = createGauge("test_solana_validator_last_vote");
    registry.registerMetric(activatedStakeGauge);
    registry.registerMetric(activeGauge);
    registry.registerMetric(commissionGauge);
    registry.registerMetric(lastVoteGauge);

    const postWithCache = createCachedVoteAccountsMock();

    const invoke = async () => {
      await updateSolanaVoteAccounts({
        validators: "vote-1",
        rpcUrl: "https://rpc.example",
        activatedStakeGauge,
        activeGauge,
        commissionGauge,
        lastVoteGauge,
        postWithCache,
      });
      return registry.metrics();
    };

    const firstMetrics = await invoke();
    const secondMetrics = await invoke();

    expect(postWithCache.calls).toBe(2);
    expect(firstMetrics).toContain('test_solana_validator_activated_stake{vote="vote-1"} 123');
    expect(firstMetrics).toContain('test_solana_validator_active{vote="vote-1"} 1');
    expect(firstMetrics).toContain('test_solana_validator_commission{vote="vote-1"} 7');
    expect(firstMetrics).toContain('test_solana_validator_last_vote{vote="vote-1"} 42');
    expect(secondMetrics).toContain('test_solana_validator_activated_stake{vote="vote-1"} 123');
    expect(secondMetrics).toContain('test_solana_validator_active{vote="vote-1"} 1');
    expect(secondMetrics).toContain('test_solana_validator_commission{vote="vote-1"} 7');
    expect(secondMetrics).toContain('test_solana_validator_last_vote{vote="vote-1"} 42');
  });
});
