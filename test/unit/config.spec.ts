import { loadRuntimeConfig } from "../../src/core/config";

describe("loadRuntimeConfig", () => {
  it("prefers CHAIN over legacy BLOCKCHAIN and resolves solana address semantics", () => {
    const config = loadRuntimeConfig({
      CHAIN: "solana",
      BLOCKCHAIN: "./availables/tendermint.ts",
      PORT: "29999",
      RPC_URL: "https://solana.example/rpc",
      VOTE: "vote-a,vote-b",
      IDENTITY: "identity-a",
      ADDRESS: "ignored-address",
      VALIDATOR: "ignored-validator",
    });

    expect(config.chainId).toBe("solana");
    expect(config.chainSource).toBe("CHAIN");
    expect(config.port).toBe(29999);
    expect(config.collectorAddresses).toBe("vote-a,vote-b");
    expect(config.collectorValidator).toBe("identity-a");
  });

  it("maps legacy BLOCKCHAIN paths to supported CHAIN ids", () => {
    const config = loadRuntimeConfig({
      BLOCKCHAIN: "./availables/testnet/solana.ts",
      RPC_URL: "https://solana-testnet.example/rpc",
      VOTE: "vote-account",
      IDENTITY: "identity-account",
    });

    expect(config.chainId).toBe("solana-testnet");
    expect(config.chainSource).toBe("BLOCKCHAIN");
  });

  it("fails fast when required configuration is missing", () => {
    expect(() =>
      loadRuntimeConfig({
        CHAIN: "berachain",
        API_URL: "https://api.example",
        ADDRESS: "0xabc",
        VALIDATOR: "0xdef",
      }),
    ).toThrow('Missing required configuration for chain "berachain": EVM_API_URL');
  });

  it("keeps the default RPC URL for non-solana chains", () => {
    const config = loadRuntimeConfig({
      CHAIN: "tendermint",
      API_URL: "https://cosmos.example",
      ADDRESS: "cosmos1abc",
      VALIDATOR: "cosmosvaloper1def",
    });

    expect(config.rpcUrl).toBe("http://localhost:26657");
  });
});
