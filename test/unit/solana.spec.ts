import { register } from "prom-client";
import Solana from "../../src/availables/solana";

type Selector = (response: { data: unknown }) => unknown;
type PostWithCacheMock = jest.Mock<Promise<unknown>, [string, unknown, Selector, number?, number?]>;
type TestCollector = {
  validatorToIdentityMap: Record<string, string>;
  registry: { metrics(): Promise<string> };
  postWithCache: PostWithCacheMock;
  updateBlockProductionFromRpc(validators: string): Promise<void>;
  updateCurrentEpochMetricsFromIndexer(validators: string): Promise<void>;
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

  it("derives slot metrics from getBlockProduction and zero-fills missing identities", async () => {
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

        if (method === "getEpochInfo") {
          return selector({ data: { result: { epoch: 956 } } });
        }

        throw new Error(`Unexpected RPC method: ${String(method)}`);
      },
    );

    await collector.updateBlockProductionFromRpc("vote-1,vote-2");

    const metrics = await collector.registry.metrics();
    expect(metrics).toContain('solana_slots_assigned_total{vote="vote-1",epoch="956"} 12');
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
    expect(metrics).toContain('solana_block_tips_median_sol{vote="vote-1",epoch="956"} 0');
    expect(metrics).not.toContain("solana_block_fees_median_sol{");
    expect(metrics).not.toContain("solana_slots_assigned_total{");
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
                  slotsStatus: "final",
                  slotsAssigned: 12,
                  slotsProduced: 10,
                  slotsSkipped: 2,
                  feesStatus: "final",
                  blockFeesTotalSol: "0.75",
                  mevStatus: "final",
                  mevRewardsSol: "0.5",
                },
                {
                  vote: "vote-2",
                  identity: "identity-2",
                  epoch: 956,
                  slotsStatus: "live",
                  slotsAssigned: 6,
                  slotsProduced: 5,
                  slotsSkipped: 1,
                  feesStatus: "live",
                  blockFeesTotalSol: "0.125",
                  mevStatus: "approximate",
                  mevRewardsSol: "0.1",
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
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-1",epoch="956"} 0.75');
    expect(metrics).toContain('solana_mev_fees_total_sol{vote="vote-1",epoch="956"} 0.5');
    expect(metrics).toContain('solana_slots_status{vote="vote-1",epoch="956",status="final"} 1');
    expect(metrics).toContain(
      'solana_block_fees_status{vote="vote-1",epoch="956",status="final"} 1',
    );
    expect(metrics).toContain('solana_mev_fees_status{vote="vote-1",epoch="956",status="final"} 1');
    expect(metrics).toContain('solana_slots_assigned_total{vote="vote-2",epoch="956"} 6');
    expect(metrics).toContain('solana_slots_produced_total{vote="vote-2",epoch="956"} 5');
    expect(metrics).toContain('solana_slots_skipped_total{vote="vote-2",epoch="956"} 1');
    expect(metrics).toContain('solana_block_fees_total_sol{vote="vote-2",epoch="956"} 0.125');
    expect(metrics).toContain('solana_mev_fees_total_sol{vote="vote-2",epoch="956"} 0.1');
    expect(metrics).toContain('solana_slots_status{vote="vote-2",epoch="956",status="live"} 1');
    expect(metrics).toContain(
      'solana_block_fees_status{vote="vote-2",epoch="956",status="live"} 1',
    );
    expect(metrics).toContain(
      'solana_mev_fees_status{vote="vote-2",epoch="956",status="approximate"} 1',
    );
    expect(metrics).not.toContain("solana_block_tips_median_sol{");
    expect(metrics).not.toContain("solana_epoch_median_base_fees_avg_sol{");
  });
});
