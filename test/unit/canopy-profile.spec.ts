import { resolveChainProfile } from "../../src/core/collector-registry";

describe("canopy chain profiles", () => {
  it("resolves the mainnet collector by CHAIN id and alias", () => {
    expect(resolveChainProfile("canopy").id).toBe("canopy");
    expect(resolveChainProfile("canopy-mainnet").id).toBe("canopy");
  });

  it("maps legacy BLOCKCHAIN module paths", () => {
    expect(resolveChainProfile("./availables/canopy.js").id).toBe("canopy");
    expect(resolveChainProfile("./availables/testnet/canopy.js").id).toBe("canopy-testnet");
  });
});
