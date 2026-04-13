import {
  getAlchemyApiKey,
  getDecimalPlaces,
  getEvmApiUrl,
  getMonadValidatorId,
  getOptionalEnv,
} from "../../src/core/runtime-env";

describe("runtime env helpers", () => {
  it("returns trimmed optional env values", () => {
    expect(getOptionalEnv("CHAIN", { CHAIN: " solana " })).toBe("solana");
    expect(getOptionalEnv("CHAIN", {})).toBe("");
  });

  it("parses decimal places with fallback", () => {
    expect(getDecimalPlaces(6, { DECIMAL_PLACES: "18" })).toBe(18);
    expect(getDecimalPlaces(6, { DECIMAL_PLACES: "NaN" })).toBe(6);
  });

  it("reads EVM and Alchemy settings from env", () => {
    const env = {
      EVM_API_URL: "https://rpc.example",
      ALCHEMY_API_KEY: "secret",
    };

    expect(getEvmApiUrl(env)).toBe("https://rpc.example");
    expect(getAlchemyApiKey(env)).toBe("secret");
  });

  it("prefers MONAD_VALIDATOR_ID over VALIDATOR_ID", () => {
    expect(
      getMonadValidatorId({
        MONAD_VALIDATOR_ID: "101",
        VALIDATOR_ID: "202",
      }),
    ).toBe("101");

    expect(getMonadValidatorId({ VALIDATOR_ID: "202" })).toBe("202");
    expect(getMonadValidatorId({})).toBeUndefined();
  });
});
