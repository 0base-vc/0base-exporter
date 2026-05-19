import {
  CUSTOM_BLOCKCHAIN_CHAIN_ID,
  findChainProfileByLegacyModulePath,
  resolveChainProfile,
} from "./collector-registry";
import type { ChainProfile, RuntimeConfig } from "./types";

const DEFAULT_CHAIN_ID = "tendermint";
const DEFAULT_PORT = 27770;
const DEFAULT_RPC_URL = "http://localhost:26657";

function firstPopulated(...values: Array<string | undefined>): string {
  return values.map((value) => value?.trim() ?? "").find((value) => value.length > 0) ?? "";
}

function normalizeCsv(value: string): string {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(",");
}

function resolveChainFromEnv(env: NodeJS.ProcessEnv): {
  chainId: string;
  chainSource: RuntimeConfig["chainSource"];
  rawChainInput?: string;
} {
  if (env.CHAIN?.trim()) {
    const rawChainInput = env.CHAIN.trim();
    return {
      chainId: resolveChainProfile(rawChainInput).id,
      chainSource: "CHAIN",
      rawChainInput,
    };
  }

  if (env.BLOCKCHAIN?.trim()) {
    const rawChainInput = env.BLOCKCHAIN.trim();
    const legacyProfile = findChainProfileByLegacyModulePath(rawChainInput);
    if (legacyProfile) {
      return {
        chainId: legacyProfile.id,
        chainSource: "BLOCKCHAIN",
        rawChainInput,
      };
    }

    try {
      const resolvedProfile = resolveChainProfile(rawChainInput);
      return {
        chainId: resolvedProfile.id,
        chainSource: "BLOCKCHAIN",
        rawChainInput,
      };
    } catch {
      return {
        chainId: CUSTOM_BLOCKCHAIN_CHAIN_ID,
        chainSource: "BLOCKCHAIN",
        rawChainInput,
      };
    }
  }

  return {
    chainId: DEFAULT_CHAIN_ID,
    chainSource: "default",
  };
}

function selectCollectorAddresses(env: NodeJS.ProcessEnv): string {
  return normalizeCsv(firstPopulated(env.VOTE, env.ADDRESS));
}

function selectCollectorValidator(env: NodeJS.ProcessEnv): string {
  return normalizeCsv(firstPopulated(env.IDENTITY, env.VALIDATOR));
}

function parsePort(portValue?: string): number {
  if (!portValue) {
    return DEFAULT_PORT;
  }

  const parsed = Number(portValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value "${portValue}"`);
  }

  return parsed;
}

function validateRequiredValues(profile: ChainProfile, config: RuntimeConfig): void {
  const requirements: Record<string, string> = {
    API_URL: config.apiUrl,
    RPC_URL: config.rpcUrl,
    EVM_API_URL: config.env.EVM_API_URL?.trim() ?? "",
    COLLECTOR_ADDRESSES: config.collectorAddresses,
    COLLECTOR_VALIDATOR: config.collectorValidator,
  };

  const missing = profile.requiredEnv.filter((key) => !requirements[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration for chain "${profile.id}": ${missing.join(", ")}`,
    );
  }
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const chainResolution = resolveChainFromEnv(env);
  const profile =
    chainResolution.chainId === CUSTOM_BLOCKCHAIN_CHAIN_ID
      ? undefined
      : resolveChainProfile(chainResolution.chainId);
  const collectorAddresses = selectCollectorAddresses(env);
  const collectorValidator = selectCollectorValidator(env);

  const config: RuntimeConfig = {
    port: parsePort(env.PORT),
    chainId: profile?.id ?? CUSTOM_BLOCKCHAIN_CHAIN_ID,
    chainSource: chainResolution.chainSource,
    rawChainInput: chainResolution.rawChainInput,
    apiUrl: env.API_URL?.trim() ?? "",
    rpcUrl: env.RPC_URL?.trim() ?? (profile?.family === "solana" ? "" : DEFAULT_RPC_URL),
    existingMetricsUrl: env.EXISTING_METRICS_URL?.trim() ?? "",
    collectorAddresses,
    collectorValidator,
    enablePromPerf: ["1", "true", "yes"].includes((env.ENABLE_PROM_PERF ?? "").toLowerCase()),
    env,
  };

  if (profile) {
    validateRequiredValues(profile, config);
  }

  return config;
}
