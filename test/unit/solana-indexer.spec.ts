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
        if (url === "https://whoearns.live/v1/validators/current-epoch/batch") {
          return selector({
            data: {
              epoch: 959,
              results: [
                {
                  vote: "vote-1",
                  identity: "identity-1",
                  epoch: 959,
                  isCurrentEpoch: true,
                  isFinal: false,
                  hasSlots: true,
                  hasIncome: true,
                  slotsAssigned: 16,
                  slotsProduced: 12,
                  slotsSkipped: 0,
                  blockBaseFeesTotalSol: "0.1",
                  blockPriorityFeesTotalSol: "0.4",
                  blockFeesTotalSol: "0.5",
                  blockTipsTotalSol: "0.125",
                  totalIncomeSol: "0.625",
                  medianBlockFeeSol: "0.04",
                  medianBlockBaseFeeSol: "0.01",
                  medianBlockPriorityFeeSol: "0.03",
                  medianBlockTipSol: "0.02",
                  medianBlockTotalSol: "0.06",
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
    expect(metrics).toContain('solana_block_base_fees_total_sol{vote="vote-1",epoch="959"} 0.1');
    expect(metrics).toContain(
      'solana_block_priority_fees_total_sol{vote="vote-1",epoch="959"} 0.4',
    );
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-1",epoch="959"} 0.5');
    expect(metrics).toContain('solana_block_tips_total_sol{vote="vote-1",epoch="959"} 0.125');
    expect(metrics).toContain('solana_total_income_sol{vote="vote-1",epoch="959"} 0.625');
    expect(metrics).toContain('solana_mev_fees_total_sol{vote="vote-1",epoch="959"} 0.125');
    expect(metrics).toContain('solana_validator_epoch_current{vote="vote-1",epoch="959"} 1');
    expect(metrics).toContain('solana_validator_epoch_final{vote="vote-1",epoch="959"} 0');
    expect(metrics).toContain('solana_slots_available{vote="vote-1",epoch="959"} 1');
    expect(metrics).toContain('solana_income_available{vote="vote-1",epoch="959"} 1');
    expect(metrics).toContain('solana_block_fees_median_sol{vote="vote-1",epoch="959"} 0.04');
    expect(metrics).toContain('solana_block_base_fees_median_sol{vote="vote-1",epoch="959"} 0.01');
    expect(metrics).toContain(
      'solana_block_priority_fees_median_sol{vote="vote-1",epoch="959"} 0.03',
    );
    expect(metrics).toContain('solana_block_tips_median_sol{vote="vote-1",epoch="959"} 0.02');
    expect(metrics).toContain('solana_block_total_median_sol{vote="vote-1",epoch="959"} 0.06');
    expect(collector.postWithCache).toHaveBeenCalledTimes(1);
  });
});
