import { register } from "prom-client";
import Solana from "../../src/availables/solana";

type Selector = (response: { data: unknown }) => unknown;
type PostWithCacheMock = jest.Mock<Promise<unknown>, [string, unknown, Selector, number?, number?]>;
type TestCollector = {
  validatorToIdentityMap: Record<string, string>;
  registry: { metrics(): Promise<string> };
  postWithCache: PostWithCacheMock;
  updateCurrentEpochMetricsFromIndexer(validators: string): Promise<void>;
};

describe("Solana indexer integration", () => {
  beforeEach(() => {
    register.clear();
  });

  afterEach(() => {
    register.clear();
  });

  it("uses current-epoch slot totals directly from the indexer response", async () => {
    const collector = new Solana(
      "",
      "https://rpc.example",
      "https://rpc.example",
      "vote-1",
      "identity-1",
      "",
    ) as unknown as TestCollector;

    collector.postWithCache = jest.fn(
      async (url: string, _data: unknown, selector: Selector): Promise<unknown> => {
        if (
          url === "https://solana-validator-indexer.0base.dev/v1/validators/current-epoch/batch"
        ) {
          return selector({
            data: {
              epoch: 959,
              results: [
                {
                  vote: "vote-1",
                  identity: "identity-1",
                  epoch: 959,
                  slotsStatus: "partial",
                  slotsAssigned: 16,
                  slotsProduced: 12,
                  slotsSkipped: 0,
                  feesStatus: "partial",
                  blockFeesTotalSol: "0.5",
                  mevStatus: "unavailable",
                  mevRewardsSol: null,
                },
              ],
            },
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    await collector.updateCurrentEpochMetricsFromIndexer("vote-1");

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_slots_assigned_total{vote="vote-1",epoch="959"} 16');
    expect(metrics).toContain('solana_slots_produced_total{vote="vote-1",epoch="959"} 12');
    expect(metrics).toContain('solana_slots_skipped_total{vote="vote-1",epoch="959"} 0');
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-1",epoch="959"} 0.5');
    expect(collector.postWithCache).toHaveBeenCalledTimes(1);
  });
});
