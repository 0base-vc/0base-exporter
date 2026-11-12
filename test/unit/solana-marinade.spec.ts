import { publishedMarinadeAuction } from "../../src/availables/shared/solana-marinade";

const score = (epoch: number, target: number, total: number) => ({
  epoch,
  marinadeSamTargetSol: target,
  revShare: { totalPmpe: total, inflationPmpe: 57, mevPmpe: 18 },
  values: { commissions: { inflationCommissionDec: 0.05, mevCommissionDec: 0.1 } },
});

describe("published Marinade auction reference", () => {
  it("uses the latest epoch and lowest winning total, recovering gross rewards", () => {
    expect(
      publishedMarinadeAuction([
        score(1082, 1000, 1),
        score(1083, 0, 2),
        score(1083, 1000, 110),
        score(1083, 2000, 100),
      ]),
    ).toEqual({ epoch: 1083, winningTotalPmpe: 100, inflationPmpe: 60, mevPmpe: 20 });
  });

  it("skips rows whose full commission prevents recovering gross rewards", () => {
    const invalid = score(1083, 1000, 100);
    invalid.values.commissions.inflationCommissionDec = 1;
    expect(publishedMarinadeAuction([invalid, score(1083, 2000, 110)]).inflationPmpe).toBe(60);
  });

  it.each([null, [], [score(1083, 0, 100)], [score(1083, 1000, NaN)]].map((rows) => ({ rows })))(
    "rejects missing or invalid auction data instead of emitting a zero reference",
    ({ rows }) => {
      expect(() => publishedMarinadeAuction(rows)).toThrow();
    },
  );

  it("does not silently use an older epoch when the latest has no winners", () => {
    expect(() => publishedMarinadeAuction([score(1082, 1000, 100), score(1083, 0, 110)])).toThrow();
  });
});
