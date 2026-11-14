import { register } from "prom-client";
import Solana from "../../src/availables/solana";
import {
  fetchLiveMarinadeAuction,
  MARINADE_LIVE_MAX_AGE_MS,
  type MarinadeLiveReference,
} from "../../src/availables/shared/solana-marinade-live";

jest.mock("../../src/availables/shared/solana-marinade-live", () => ({
  ...jest.requireActual("../../src/availables/shared/solana-marinade-live"),
  fetchLiveMarinadeAuction: jest.fn(),
}));

type Collector = {
  registry: { metrics(): Promise<string> };
  updateMarinadeLiveAuction(): void;
  liveAuctionRefresh: Promise<void> | null;
  applyEffBidToVotes(cutoff: number, inflation: number, mev: number): Promise<void>;
};
const reference: MarinadeLiveReference = {
  epoch: 1086,
  validators: [
    { vote: "vote-1", commission: "5", mevCommission: "10", bid: 28, minimumBid: 27, margin: 1 },
  ],
};
const create = () =>
  new Solana(
    "",
    "https://rpc.example",
    "https://rpc.example",
    "vote-1",
    "id-1",
  ) as unknown as Collector;

describe("Solana live auction collection", () => {
  beforeEach(() => register.clear());
  afterEach(() => register.clear());

  it("deduplicates background work without waiting for it in the scrape", async () => {
    let finish: (value: MarinadeLiveReference) => void;
    const fetcher = jest.mocked(fetchLiveMarinadeAuction).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const collector = create();
    expect(collector.updateMarinadeLiveAuction()).toBeUndefined();
    collector.updateMarinadeLiveAuction();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await collector.registry.metrics()).toContain("solana_marinade_live_auction_up 0");
    finish(reference);
    await collector.liveAuctionRefresh;
    const metrics = await collector.registry.metrics();
    expect(metrics).toContain(
      'solana_marinade_live_bid_margin_sol{vote="vote-1",commission="5",mev_commission="10"} 1',
    );
    expect(metrics).toContain("solana_marinade_live_auction_up 1");
    expect(metrics).toContain("solana_marinade_live_auction_epoch 1086");
  });

  it("clears a failed live result and never substitutes the published reference", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetcher = jest
      .mocked(fetchLiveMarinadeAuction)
      .mockResolvedValueOnce(reference)
      .mockRejectedValueOnce(new Error("unavailable"));
    const collector = create();
    await collector.applyEffBidToVotes(100, 60, 20);
    collector.updateMarinadeLiveAuction();
    await collector.liveAuctionRefresh;
    clock.mockReturnValue(1_061_000);
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    collector.updateMarinadeLiveAuction();
    await collector.liveAuctionRefresh;
    const metrics = await collector.registry.metrics();
    expect(metrics).toContain("solana_marinade_live_auction_up 0");
    expect(metrics).not.toContain("solana_marinade_live_bid_margin_sol{");
    expect(metrics).toContain(
      'solana_marinade_min_effective_bid_sol{vote="vote-1",commission="5",mev_commission="10"} 25',
    );
    collector.updateMarinadeLiveAuction();
    expect(fetcher).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("removes stale results while a slow refresh is still in flight", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    let finish: (value: MarinadeLiveReference) => void;
    jest
      .mocked(fetchLiveMarinadeAuction)
      .mockResolvedValueOnce(reference)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    const collector = create();
    collector.updateMarinadeLiveAuction();
    await collector.liveAuctionRefresh;
    clock.mockReturnValue(1_061_000);
    collector.updateMarinadeLiveAuction();
    clock.mockReturnValue(1_000_000 + MARINADE_LIVE_MAX_AGE_MS + 1);
    collector.updateMarinadeLiveAuction();
    const metrics = await collector.registry.metrics();
    expect(metrics).toContain("solana_marinade_live_auction_up 0");
    expect(metrics).not.toContain("solana_marinade_live_bid_margin_sol{");
    finish(reference);
    await collector.liveAuctionRefresh;
  });
});
