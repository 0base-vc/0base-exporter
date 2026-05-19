import { toDecimal, toPercent } from "../../src/core/decimal";

describe("decimal helpers", () => {
  it("converts integer strings to decimal numbers", () => {
    expect(toDecimal("1234567", 6)).toBe(1.234567);
  });

  it("preserves the sign when converting decimals", () => {
    expect(toDecimal("-1200", 3)).toBe(-1.2);
  });

  it("derives percentages from fixed-point decimals", () => {
    expect(toPercent("250000000000000000", 18)).toBe(25);
  });
});
