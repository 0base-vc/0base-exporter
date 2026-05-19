import type TargetAbstract from "../target.abstract";
import type { Logger } from "./logger";

export type ChainFamily = "cosmos" | "solana" | "evm" | "hybrid";

export interface RuntimeConfig {
  port: number;
  chainId: string;
  chainSource: "CHAIN" | "BLOCKCHAIN" | "default";
  rawChainInput?: string;
  apiUrl: string;
  rpcUrl: string;
  existingMetricsUrl: string;
  collectorAddresses: string;
  collectorValidator: string;
  enablePromPerf: boolean;
  env: NodeJS.ProcessEnv;
}

export interface CollectorContext {
  config: RuntimeConfig;
  logger: Logger;
}

export type CollectorFactory = (context: CollectorContext) => TargetAbstract;

export interface ChainProfile {
  id: string;
  family: ChainFamily;
  description: string;
  aliases: string[];
  legacyModulePaths: string[];
  requiredEnv: string[];
  optionalEnv?: string[];
  factory: CollectorFactory;
}
