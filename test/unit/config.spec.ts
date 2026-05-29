import { loadRuntimeConfig } from "../../src/core/config";
import { createCollector, resolveLegacyCustomModulePath } from "../../src/core/collector-registry";
import { logger } from "../../src/core/logger";
import * as path from "path";

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

  it("keeps restored legacy collector module paths addressable", () => {
    const tgrade = loadRuntimeConfig({
      BLOCKCHAIN: "./availables/tendermint-tgrade.ts",
      API_URL: "https://tgrade.example",
      VOTE: "tgrade1abc",
      IDENTITY: "tgradevaloper1def",
    });
    const initia = loadRuntimeConfig({
      BLOCKCHAIN: "./availables/testnet/initia.ts",
      API_URL: "https://initia.example",
      VOTE: "init1abc",
      IDENTITY: "initvaloper1def",
    });
    const ritual = loadRuntimeConfig({
      BLOCKCHAIN: "./availables/testnet/ritual.ts",
      API_URL: "https://ritual-cl.example",
      EVM_API_URL: "https://ritual-el.example",
      ADDRESS: "0xabc",
    });

    expect(tgrade.chainId).toBe("tendermint-tgrade");
    expect(initia.chainId).toBe("initia-testnet");
    expect(ritual.chainId).toBe("ritual-testnet");
  });

  it("preserves legacy VOTE and IDENTITY precedence during CHAIN migration", () => {
    const config = loadRuntimeConfig({
      CHAIN: "tendermint-v1",
      API_URL: "https://cosmos.example",
      ADDRESS: "cosmos1address",
      VOTE: "cosmos1vote",
      VALIDATOR: "cosmosvaloper1validator",
      IDENTITY: "cosmosvaloper1identity",
    });

    expect(config.collectorAddresses).toBe("cosmos1vote");
    expect(config.collectorValidator).toBe("cosmosvaloper1identity");
  });

  it("preserves legacy VOTE and IDENTITY precedence for the default collector", () => {
    const config = loadRuntimeConfig({
      API_URL: "https://cosmos.example",
      ADDRESS: "cosmos1address",
      VOTE: "cosmos1vote",
      VALIDATOR: "cosmosvaloper1validator",
      IDENTITY: "cosmosvaloper1identity",
    });

    expect(config.chainId).toBe("tendermint");
    expect(config.collectorAddresses).toBe("cosmos1vote");
    expect(config.collectorValidator).toBe("cosmosvaloper1identity");
  });

  it("keeps unknown legacy BLOCKCHAIN paths available for dynamic loading", () => {
    const config = loadRuntimeConfig({
      BLOCKCHAIN: "./availables/custom.ts",
      VOTE: "legacy-address",
      IDENTITY: "legacy-validator",
    });

    expect(config.chainId).toBe("__custom_blockchain__");
    expect(config.rawChainInput).toBe("./availables/custom.ts");
    expect(config.collectorAddresses).toBe("legacy-address");
    expect(config.collectorValidator).toBe("legacy-validator");
  });

  it("loads unknown legacy BLOCKCHAIN modules dynamically", async () => {
    const config = loadRuntimeConfig({
      BLOCKCHAIN: path.resolve(__dirname, "../fixtures/custom-blockchain.ts"),
      API_URL: "https://custom.example",
      RPC_URL: "https://rpc.example",
      VOTE: "legacy-address",
      IDENTITY: "legacy-validator",
    });

    const collector = createCollector({ config, logger });

    await expect(collector.makeMetrics()).resolves.toBe(
      "https://custom.example|https://rpc.example|legacy-address|legacy-validator",
    );
  });

  it("preserves Node resolution for bare legacy BLOCKCHAIN specifiers", () => {
    expect(resolveLegacyCustomModulePath("path")).toBe("path");
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

  it("fails fast when testnet hybrid collectors miss API_URL", () => {
    for (const chain of ["monad-testnet", "mitosis-testnet", "story-testnet", "ritual-testnet"]) {
      expect(() =>
        loadRuntimeConfig({
          CHAIN: chain,
          EVM_API_URL: "https://evm.example",
          ADDRESS: "0xabc",
          VALIDATOR: "0xdef",
        }),
      ).toThrow(`Missing required configuration for chain "${chain}": API_URL`);
    }
  });

  it("allows Ritual testnet to select validators by address without VALIDATOR", () => {
    const config = loadRuntimeConfig({
      CHAIN: "ritual-testnet",
      API_URL: "https://ritual-cl.example",
      EVM_API_URL: "https://ritual-el.example",
      ADDRESS: "0xFBF57F6b80578F4918684BAbB5dA70Fac504bdB3",
    });

    expect(config.chainId).toBe("ritual-testnet");
    expect(config.collectorAddresses).toBe("0xFBF57F6b80578F4918684BAbB5dA70Fac504bdB3");
    expect(config.collectorValidator).toBe("");
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
