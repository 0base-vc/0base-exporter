import { register } from "prom-client";
import Solana from "../../src/availables/solana";

type Selector = (response: { data: unknown }) => unknown;
type PostWithCacheMock = jest.Mock<Promise<unknown>, [string, unknown, Selector, number?, number?]>;
type TestCollector = {
  validatorToIdentityMap: Record<string, string>;
  registry: { metrics(): Promise<string> };
  postWithCache: PostWithCacheMock;
  updateBlockProductionFromRpc(validators: string): Promise<void>;
  updateCurrentEpochMetrics(validators: string): Promise<void>;
  updateCurrentEpochMetricsFromIndexer(validators: string): Promise<boolean>;
  updateEpochIncomeFromVx(validators: string): Promise<void>;
  updateEpochMedianFeesAverages(): Promise<void>;
};

describe("Solana vx.tools fallbacks", () => {
  beforeEach(() => {
    register.clear();
  });

  afterEach(() => {
    register.clear();
  });

  function createCollector(): TestCollector {
    return new Solana(
      "",
      "https://rpc.example",
      "https://rpc.example",
      "vote-1",
      "identity-1",
      "",
    ) as unknown as TestCollector;
  }

  it("uses leader schedule for assigned slots and block production for produced slots", async () => {
    const collector = createCollector();
    collector.validatorToIdentityMap = {
      "vote-1": "identity-1",
      "vote-2": "identity-2",
    };
    collector.postWithCache = jest.fn(
      async (url: string, data: unknown, selector: Selector): Promise<unknown> => {
        if (url !== "https://rpc.example") {
          throw new Error(`Unexpected URL: ${url}`);
        }

        const method = (data as { method?: string }).method;
        if (method === "getBlockProduction") {
          return selector({
            data: {
              result: {
                value: {
                  byIdentity: {
                    "identity-1": [12, 10],
                  },
                },
              },
            },
          });
        }

        if (method === "getLeaderSchedule") {
          const identity = (data as { params?: [unknown, { identity?: string }] }).params?.[1]
            ?.identity;
          const slotsByIdentity: Record<string, number[]> =
            identity === "identity-1"
              ? { "identity-1": Array.from({ length: 16 }, (_value, index) => index) }
              : { "identity-2": [] };
          return selector({ data: { result: slotsByIdentity } });
        }

        if (method === "getEpochInfo") {
          return selector({ data: { result: { epoch: 956 } } });
        }

        throw new Error(`Unexpected RPC method: ${String(method)}`);
      },
    );

    await collector.updateBlockProductionFromRpc("vote-1,vote-2");

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_slots_assigned_total{vote="vote-1",epoch="956"} 16');
    expect(metrics).toContain('solana_slots_produced_total{vote="vote-1",epoch="956"} 10');
    expect(metrics).toContain('solana_slots_skipped_total{vote="vote-1",epoch="956"} 2');
    expect(metrics).toContain('solana_slots_assigned_total{vote="vote-2",epoch="956"} 0');
    expect(metrics).toContain('solana_slots_produced_total{vote="vote-2",epoch="956"} 0');
    expect(metrics).toContain('solana_slots_skipped_total{vote="vote-2",epoch="956"} 0');
  });

  it("zero-fills vx fee metrics when the upstream response is empty", async () => {
    const collector = createCollector();
    collector.validatorToIdentityMap = { "vote-1": "identity-1" };
    collector.postWithCache = jest.fn(
      async (url: string, _data: unknown, selector: Selector): Promise<unknown> => {
        if (url === "https://api.vx.tools/epochs/income") {
          return "";
        }

        if (url === "https://rpc.example") {
          return selector({ data: { result: { epoch: 956 } } });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    );

    await collector.updateEpochIncomeFromVx("vote-1");

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-1",epoch="956"} 0');
    expect(metrics).toContain('solana_mev_fees_total_sol{vote="vote-1",epoch="956"} 0');
    expect(metrics).toContain('solana_block_fees_median_sol{vote="vote-1",epoch="956"} 0');
    expect(metrics).toContain('solana_block_tips_median_sol{vote="vote-1",epoch="956"} 0');
    expect(metrics).not.toContain("solana_slots_assigned_total{");
  });

  it("emits vx median fee metrics when fallback income data is available", async () => {
    const collector = createCollector();
    collector.validatorToIdentityMap = { "vote-1": "identity-1" };
    collector.postWithCache = jest.fn(
      async (url: string, _data: unknown, selector: Selector): Promise<unknown> => {
        if (url === "https://api.vx.tools/epochs/income") {
          return selector({
            data: [
              {
                epoch: 956,
                totalIncome: {
                  baseFees: 1_000_000_000,
                  priorityFees: 2_000_000_000,
                  mevTips: 3_000_000_000,
                },
                medianIncome: {
                  baseFees: 40_000_000,
                  priorityFees: 60_000_000,
                  mevTips: 50_000_000,
                },
              },
            ],
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    );

    await collector.updateEpochIncomeFromVx("vote-1");

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-1",epoch="956"} 3');
    expect(metrics).toContain('solana_mev_fees_total_sol{vote="vote-1",epoch="956"} 3');
    expect(metrics).toContain('solana_block_fees_median_sol{vote="vote-1",epoch="956"} 0.1');
    expect(metrics).toContain('solana_block_tips_median_sol{vote="vote-1",epoch="956"} 0.05');
  });

  it("zero-fills vx leaderboard averages when the upstream response is empty", async () => {
    const collector = createCollector();
    collector.postWithCache = jest.fn(
      async (url: string, _data: unknown, selector: Selector): Promise<unknown> => {
        if (url === "https://api.vx.tools/epochs/leaderboard/income") {
          return "";
        }

        if (url === "https://rpc.example") {
          return selector({ data: { result: { epoch: 956 } } });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    );

    await collector.updateEpochMedianFeesAverages();

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_epoch_median_base_fees_avg_sol{epoch="956"} 0');
    expect(metrics).toContain('solana_epoch_median_priority_fees_avg_sol{epoch="956"} 0');
    expect(metrics).toContain('solana_epoch_median_mev_tips_avg_sol{epoch="956"} 0');
    expect(metrics).not.toContain("solana_epoch_top50_validator_base_fees_avg_sol{");
    expect(metrics).not.toContain("solana_epoch_top50_validator_priority_fees_avg_sol{");
    expect(metrics).not.toContain("solana_epoch_top50_validator_mev_tips_avg_sol{");
  });

  it("emits vx leaderboard averages and top50 validator compatibility metrics", async () => {
    const collector = createCollector();
    collector.postWithCache = jest.fn(
      async (url: string, _data: unknown, selector: Selector): Promise<unknown> => {
        if (url === "https://api.vx.tools/epochs/leaderboard/income") {
          return selector({
            data: {
              epoch: 956,
              records: [
                {
                  nodeAddress: "validator-low",
                  nodeName: "Low",
                  stake: 50,
                  confirmedSlots: 10,
                  totalIncome: {
                    baseFees: 1_000_000_000,
                    priorityFees: 2_000_000_000,
                    mevTips: 3_000_000_000,
                  },
                },
                {
                  nodeAddress: "validator-high",
                  nodeName: "High",
                  stake: 100,
                  confirmedSlots: 20,
                  totalIncome: {
                    baseFees: 6_000_000_000,
                    priorityFees: 8_000_000_000,
                    mevTips: 10_000_000_000,
                  },
                },
              ],
            },
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    );

    await collector.updateEpochMedianFeesAverages();

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_epoch_median_base_fees_avg_sol{epoch="956"} 0.2333333333');
    expect(metrics).toContain(
      'solana_epoch_median_priority_fees_avg_sol{epoch="956"} 0.3333333333',
    );
    expect(metrics).toContain('solana_epoch_median_mev_tips_avg_sol{epoch="956"} 0.4333333333');
    expect(metrics).toContain(
      'solana_epoch_top50_validator_base_fees_avg_sol{epoch="956",rank="1",validator="validator-high",name="High",stake="100"} 0.3',
    );
    expect(metrics).toContain(
      'solana_epoch_top50_validator_priority_fees_avg_sol{epoch="956",rank="2",validator="validator-low",name="Low",stake="50"} 0.2',
    );
    expect(metrics).toContain(
      'solana_epoch_top50_validator_mev_tips_avg_sol{epoch="956",rank="1",validator="validator-high",name="High",stake="100"} 0.5',
    );
  });

  it("emits numeric indexer metrics independently from status and exposes status gauges", async () => {
    const collector = new Solana(
      "",
      "https://rpc.example",
      "https://rpc.example",
      "vote-1,vote-2",
      "identity-1,identity-2",
      "",
    ) as unknown as TestCollector;

    collector.postWithCache = jest.fn(
      async (url: string, data: unknown, selector: Selector): Promise<unknown> => {
        if (url === "https://whoearns.live/v1/validators/current-epoch/batch") {
          expect(data).toEqual({ votes: ["vote-1", "vote-2"] });

          return selector({
            data: {
              epoch: 956,
              results: [
                {
                  vote: "vote-1",
                  identity: "identity-1",
                  epoch: 956,
                  isCurrentEpoch: false,
                  isFinal: true,
                  hasSlots: true,
                  hasIncome: true,
                  slotsAssigned: 12,
                  slotsProduced: 10,
                  slotsSkipped: 2,
                  blockBaseFeesTotalSol: "0.2",
                  blockPriorityFeesTotalSol: "0.55",
                  blockFeesTotalSol: "0.75",
                  blockTipsTotalSol: "0.5",
                  totalIncomeSol: "1.25",
                  medianBlockFeeSol: "0.075",
                  medianBlockBaseFeeSol: "0.02",
                  medianBlockPriorityFeeSol: "0.055",
                  medianBlockTipSol: "0.05",
                  medianBlockTotalSol: "0.125",
                },
                {
                  vote: "vote-2",
                  identity: "identity-2",
                  epoch: 956,
                  isCurrentEpoch: true,
                  isFinal: false,
                  hasSlots: true,
                  hasIncome: true,
                  slotsAssigned: 6,
                  slotsProduced: 5,
                  slotsSkipped: 1,
                  blockBaseFeesTotalSol: "0.025",
                  blockPriorityFeesTotalSol: "0.1",
                  blockFeesTotalSol: "0.125",
                  blockTipsTotalSol: "0.1",
                  totalIncomeSol: "0.225",
                  medianBlockFeeSol: "0.025",
                  medianBlockBaseFeeSol: "0.005",
                  medianBlockPriorityFeeSol: "0.02",
                  medianBlockTipSol: "0.01",
                  medianBlockTotalSol: "0.035",
                },
              ],
            },
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    );

    await collector.updateCurrentEpochMetricsFromIndexer("vote-1,vote-2");

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_slots_assigned_total{vote="vote-1",epoch="956"} 12');
    expect(metrics).toContain('solana_slots_produced_total{vote="vote-1",epoch="956"} 10');
    expect(metrics).toContain('solana_slots_skipped_total{vote="vote-1",epoch="956"} 2');
    expect(metrics).toContain('solana_block_base_fees_total_sol{vote="vote-1",epoch="956"} 0.2');
    expect(metrics).toContain(
      'solana_block_priority_fees_total_sol{vote="vote-1",epoch="956"} 0.55',
    );
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-1",epoch="956"} 0.75');
    expect(metrics).toContain('solana_block_tips_total_sol{vote="vote-1",epoch="956"} 0.5');
    expect(metrics).toContain('solana_total_income_sol{vote="vote-1",epoch="956"} 1.25');
    expect(metrics).toContain('solana_mev_fees_total_sol{vote="vote-1",epoch="956"} 0.5');
    expect(metrics).toContain('solana_validator_epoch_current{vote="vote-1",epoch="956"} 0');
    expect(metrics).toContain('solana_validator_epoch_final{vote="vote-1",epoch="956"} 1');
    expect(metrics).toContain('solana_slots_available{vote="vote-1",epoch="956"} 1');
    expect(metrics).toContain('solana_income_available{vote="vote-1",epoch="956"} 1');
    expect(metrics).toContain('solana_block_fees_median_sol{vote="vote-1",epoch="956"} 0.075');
    expect(metrics).toContain('solana_block_base_fees_median_sol{vote="vote-1",epoch="956"} 0.02');
    expect(metrics).toContain(
      'solana_block_priority_fees_median_sol{vote="vote-1",epoch="956"} 0.055',
    );
    expect(metrics).toContain('solana_block_tips_median_sol{vote="vote-1",epoch="956"} 0.05');
    expect(metrics).toContain('solana_block_total_median_sol{vote="vote-1",epoch="956"} 0.125');
    expect(metrics).toContain('solana_slots_assigned_total{vote="vote-2",epoch="956"} 6');
    expect(metrics).toContain('solana_slots_produced_total{vote="vote-2",epoch="956"} 5');
    expect(metrics).toContain('solana_slots_skipped_total{vote="vote-2",epoch="956"} 1');
    expect(metrics).toContain('solana_block_base_fees_total_sol{vote="vote-2",epoch="956"} 0.025');
    expect(metrics).toContain(
      'solana_block_priority_fees_total_sol{vote="vote-2",epoch="956"} 0.1',
    );
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-2",epoch="956"} 0.125');
    expect(metrics).toContain('solana_block_tips_total_sol{vote="vote-2",epoch="956"} 0.1');
    expect(metrics).toContain('solana_total_income_sol{vote="vote-2",epoch="956"} 0.225');
    expect(metrics).toContain('solana_mev_fees_total_sol{vote="vote-2",epoch="956"} 0.1');
    expect(metrics).toContain('solana_validator_epoch_current{vote="vote-2",epoch="956"} 1');
    expect(metrics).toContain('solana_validator_epoch_final{vote="vote-2",epoch="956"} 0');
    expect(metrics).not.toContain("solana_epoch_median_base_fees_avg_sol{");
  });

  it("clears stale indexer-only gauges before falling back to RPC and vx.tools", async () => {
    const collector = createCollector();
    collector.validatorToIdentityMap = { "vote-1": "identity-1" };
    let indexerCalls = 0;
    collector.postWithCache = jest.fn(
      async (url: string, data: unknown, selector: Selector): Promise<unknown> => {
        if (url === "https://whoearns.live/v1/validators/current-epoch/batch") {
          indexerCalls += 1;
          if (indexerCalls === 1) {
            return selector({
              data: {
                epoch: 956,
                results: [
                  {
                    vote: "vote-1",
                    identity: "identity-1",
                    epoch: 956,
                    isCurrentEpoch: true,
                    isFinal: false,
                    hasSlots: true,
                    hasIncome: true,
                    slotsAssigned: 12,
                    slotsProduced: 10,
                    slotsSkipped: 2,
                    blockBaseFeesTotalSol: "0.2",
                    blockPriorityFeesTotalSol: "0.55",
                    blockFeesTotalSol: "0.75",
                    blockTipsTotalSol: "0.5",
                    totalIncomeSol: "1.25",
                    medianBlockFeeSol: "0.075",
                    medianBlockBaseFeeSol: "0.02",
                    medianBlockPriorityFeeSol: "0.055",
                    medianBlockTipSol: "0.05",
                    medianBlockTotalSol: "0.125",
                  },
                ],
              },
            });
          }

          return selector({ data: { epoch: 957, results: [] } });
        }

        if (url === "https://rpc.example") {
          const method = (data as { method?: string }).method;
          if (method === "getBlockProduction") {
            return selector({
              data: {
                result: {
                  value: {
                    byIdentity: {
                      "identity-1": [8, 6],
                    },
                  },
                },
              },
            });
          }

          if (method === "getLeaderSchedule") {
            return selector({
              data: {
                result: {
                  "identity-1": Array.from({ length: 10 }, (_value, index) => index),
                },
              },
            });
          }

          if (method === "getEpochInfo") {
            return selector({ data: { result: { epoch: 957 } } });
          }
        }

        if (url === "https://api.vx.tools/epochs/income") {
          return "";
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    );

    await collector.updateCurrentEpochMetrics("vote-1");
    expect(await collector.registry.metrics()).toContain(
      'solana_block_base_fees_total_sol{vote="vote-1",epoch="956"} 0.2',
    );

    await collector.updateCurrentEpochMetrics("vote-1");

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_slots_assigned_total{vote="vote-1",epoch="957"} 10');
    expect(metrics).toContain('solana_slots_produced_total{vote="vote-1",epoch="957"} 6');
    expect(metrics).toContain('solana_slots_skipped_total{vote="vote-1",epoch="957"} 2');
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-1",epoch="957"} 0');
    expect(metrics).toContain('solana_mev_fees_total_sol{vote="vote-1",epoch="957"} 0');
    expect(metrics).toContain('solana_block_fees_median_sol{vote="vote-1",epoch="957"} 0');
    expect(metrics).toContain('solana_block_tips_median_sol{vote="vote-1",epoch="957"} 0');
    expect(metrics).not.toContain("solana_block_base_fees_total_sol{");
    expect(metrics).not.toContain("solana_total_income_sol{");
    expect(metrics).not.toContain("solana_validator_epoch_current{");
  });
});
