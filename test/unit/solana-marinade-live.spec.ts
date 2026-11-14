import * as sdk from "@marinade.finance/ds-sam-sdk";
import {
  fetchLiveMarinadeAuction,
  liveMarinadeBidReferences,
} from "../../src/availables/shared/solana-marinade-live";

const auction = () => ({
  winningTotalPmpe: 0.16717,
  auctionData: {
    epoch: 1086,
    validators: [
      {
        voteAccount: "vote-1",
        revShare: { totalPmpe: 0.16794, bidPmpe: 0.0283 },
        values: { commissions: { inflationCommissionDec: 0.05, mevCommissionDec: 0.1 } },
      },
    ],
  },
});

describe("live PSR auction references", () => {
  it("clears the live auction even when the bid is below an older published cutoff", () => {
    const row = liveMarinadeBidReferences(auction(), ["vote-1"]).validators[0];
    expect(row.bid).toBeLessThan(0.0285266287883415);
    expect(row.minimumBid).toBeCloseTo(0.02753, 12);
    expect(row.margin).toBeCloseTo(0.00077, 12);
    expect(row).toMatchObject({ commission: "5", mevCommission: "10" });
  });

  it("includes shared block rewards in the non-bid revenue instead of reconstructing two rewards", () => {
    const data = auction();
    data.winningTotalPmpe = 100;
    data.auctionData.validators[0].revShare = { totalPmpe: 105, bidPmpe: 20 };
    expect(liveMarinadeBidReferences(data, ["vote-1"]).validators[0]).toMatchObject({
      minimumBid: 15,
      margin: 5,
    });
  });

  it("reports an actual live shortfall", () => {
    const data = auction();
    data.auctionData.validators[0].revShare.totalPmpe = 0.16617;
    expect(liveMarinadeBidReferences(data, ["vote-1"]).validators[0].margin).toBeCloseTo(-0.001);
  });

  it("preserves SDK-supported negative commissions and stable percentage labels", () => {
    const data = auction();
    data.auctionData.validators[0].values.commissions = {
      inflationCommissionDec: -0.05,
      mevCommissionDec: 0.07,
    };
    expect(liveMarinadeBidReferences(data, ["vote-1"]).validators[0]).toMatchObject({
      commission: "-5",
      mevCommission: "7",
    });
  });

  it("rejects a missing configured vote rather than reporting a healthy zero", () => {
    expect(() => liveMarinadeBidReferences(auction(), ["vote-1", "missing"])).toThrow();
  });

  it("rejects invalid live inputs", () => {
    const data = auction();
    data.auctionData.validators[0].revShare.bidPmpe = NaN;
    expect(() => liveMarinadeBidReferences(data, ["vote-1"])).toThrow();
  });

  it("uses bounded fresh inputs and keeps validators with vote rewards when credits are null", async () => {
    let source: sdk.RawSourceData;
    const run = jest
      .spyOn(sdk.DsSamSDK.prototype, "runFinalOnly")
      .mockImplementation(async function (this: sdk.DsSamSDK) {
        const provider = (
          this as unknown as { dataProvider: { fetchSourceData(): Promise<sdk.RawSourceData> } }
        ).dataProvider;
        source = await provider.fetchSourceData();
        return auction() as unknown as sdk.AuctionResult;
      });
    const fetcher = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      let data: unknown = {};
      if (url.includes("/validators?"))
        data = {
          validators: [
            { vote_account: "vote-1", epoch_stats: [{ credits: null, vote_reward_lamports: 42 }] },
            { vote_account: "inactive", epoch_stats: [{ credits: null, vote_reward_lamports: 0 }] },
          ],
        };
      if (url.includes("/scores/")) data = [];
      if (url.endsWith(".csv")) return new Response("vote\n");
      return new Response(JSON.stringify(data));
    });
    const reference = await fetchLiveMarinadeAuction(["vote-1"]);
    expect(reference.validators[0].margin).toBeGreaterThan(0);
    expect(source.validators.validators.map((row) => row.vote_account)).toEqual(["vote-1"]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(8);
    const signal = fetcher.mock.calls[0][1]?.signal;
    expect(fetcher.mock.calls.every(([, options]) => options?.signal === signal)).toBe(true);
    expect(signal?.aborted).toBe(true);
  });

  it("aborts timed-out work without leaving the live run hanging", async () => {
    jest.useFakeTimers();
    jest.spyOn(global, "fetch").mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    try {
      const failure = expect(fetchLiveMarinadeAuction(["vote-1"])).rejects.toThrow("aborted");
      await jest.advanceTimersByTimeAsync(20_000);
      await failure;
    } finally {
      jest.useRealTimers();
    }
  });
});
