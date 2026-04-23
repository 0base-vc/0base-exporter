import AtomOne from "../availables/atomone";
import Berachain from "../availables/berachain";
import Mitosis from "../availables/mitosis";
import Monad from "../availables/monad";
import Solana from "../availables/solana";
import Tendermint from "../availables/tendermint";
import TendermintUmee from "../availables/tendermint-umee";
import TendermintV1 from "../availables/tendermint-v1";
import TendermintV1beta1 from "../availables/tendermint-v1beta1";
import TerraV2 from "../availables/terra-v2";
import Terra from "../availables/terra";
import CanopyTestnet from "../availables/testnet/canopy";
import MitosisTestnet from "../availables/testnet/mitosis";
import MonadTestnet from "../availables/testnet/monad";
import SolanaTestnet from "../availables/testnet/solana";
import StoryTestnet from "../availables/testnet/story";
import type TargetAbstract from "../target.abstract";
import type { ChainProfile, CollectorContext } from "./types";

function normalizeChainToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^src\//, "")
    .replace(/^dist\//, "")
    .replace(/\.(ts|js)$/, "");
}

function createFactory(
  Collector: new (
    existMetrics: string,
    apiUrl: string,
    rpcUrl: string,
    addresses: string,
    validator: string,
  ) => TargetAbstract,
) {
  return ({ config }: CollectorContext) =>
    new Collector(
      config.existingMetricsUrl,
      config.apiUrl,
      config.rpcUrl,
      config.collectorAddresses,
      config.collectorValidator,
    );
}

function createSolanaFactory(
  Collector: new (
    existMetrics: string,
    apiUrl: string,
    rpcUrl: string,
    votes: string,
    identities: string,
    walletAddresses?: string,
  ) => TargetAbstract,
) {
  return ({ config }: CollectorContext) =>
    new Collector(
      config.existingMetricsUrl,
      config.apiUrl,
      config.rpcUrl,
      config.collectorAddresses,
      config.collectorValidator,
      config.env.ADDRESS?.trim() ?? "",
    );
}

export const CHAIN_PROFILES: ChainProfile[] = [
  {
    id: "tendermint",
    family: "cosmos",
    description: "Legacy Tendermint/Cosmos API collector",
    aliases: ["cosmos", "cometbft"],
    legacyModulePaths: ["./availables/tendermint.ts"],
    requiredEnv: ["API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES", "RPC_URL"],
    factory: createFactory(Tendermint),
  },
  {
    id: "tendermint-v1",
    family: "cosmos",
    description: "Cosmos v1 API collector",
    aliases: ["cosmos-v1"],
    legacyModulePaths: ["./availables/tendermint-v1.ts"],
    requiredEnv: ["API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES", "RPC_URL"],
    factory: createFactory(TendermintV1),
  },
  {
    id: "tendermint-v1beta1",
    family: "cosmos",
    description: "Cosmos v1beta1 API collector",
    aliases: ["cosmos-v1beta1"],
    legacyModulePaths: ["./availables/tendermint-v1beta1.ts"],
    requiredEnv: ["API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES", "RPC_URL"],
    factory: createFactory(TendermintV1beta1),
  },
  {
    id: "terra",
    family: "cosmos",
    description: "Terra v1 collector",
    aliases: ["terra-classic"],
    legacyModulePaths: ["./availables/terra.ts"],
    requiredEnv: ["API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES", "RPC_URL"],
    factory: createFactory(Terra),
  },
  {
    id: "terra-v2",
    family: "cosmos",
    description: "Terra v2 collector",
    aliases: ["terra2"],
    legacyModulePaths: ["./availables/terra-v2.ts"],
    requiredEnv: ["API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES", "RPC_URL"],
    factory: createFactory(TerraV2),
  },
  {
    id: "atomone",
    family: "cosmos",
    description: "AtomOne collector",
    aliases: [],
    legacyModulePaths: ["./availables/atomone.ts"],
    requiredEnv: ["API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES", "RPC_URL"],
    factory: createFactory(AtomOne),
  },
  {
    id: "tendermint-umee",
    family: "cosmos",
    description: "Umee collector",
    aliases: ["umee"],
    legacyModulePaths: ["./availables/tendermint-umee.ts"],
    requiredEnv: ["API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES", "RPC_URL"],
    factory: createFactory(TendermintUmee),
  },
  {
    id: "solana",
    family: "solana",
    description: "Solana mainnet collector",
    aliases: ["solana-mainnet"],
    legacyModulePaths: ["./availables/solana.ts"],
    requiredEnv: ["RPC_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "ADDRESS", "VOTE", "IDENTITY"],
    factory: createSolanaFactory(Solana),
  },
  {
    id: "solana-testnet",
    family: "solana",
    description: "Solana testnet collector",
    aliases: ["testnet/solana", "solana-test"],
    legacyModulePaths: ["./availables/testnet/solana.ts"],
    requiredEnv: ["RPC_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "ADDRESS", "VOTE", "IDENTITY"],
    factory: createSolanaFactory(SolanaTestnet),
  },
  {
    id: "monad",
    family: "evm",
    description: "Monad collector",
    aliases: [],
    legacyModulePaths: ["./availables/monad.ts"],
    requiredEnv: ["EVM_API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["MONAD_VALIDATOR_ID", "VALIDATOR_ID", "EXISTING_METRICS_URL", "DECIMAL_PLACES"],
    factory: createFactory(Monad),
  },
  {
    id: "monad-testnet",
    family: "evm",
    description: "Monad testnet collector",
    aliases: ["testnet/monad"],
    legacyModulePaths: ["./availables/testnet/monad.ts"],
    requiredEnv: ["EVM_API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES", "API_URL", "RPC_URL"],
    factory: createFactory(MonadTestnet),
  },
  {
    id: "berachain",
    family: "hybrid",
    description: "Berachain collector",
    aliases: [],
    legacyModulePaths: ["./availables/berachain.ts"],
    requiredEnv: ["API_URL", "EVM_API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["RPC_URL", "ALCHEMY_API_KEY", "EXISTING_METRICS_URL", "DECIMAL_PLACES"],
    factory: createFactory(Berachain),
  },
  {
    id: "mitosis",
    family: "hybrid",
    description: "Mitosis collector",
    aliases: [],
    legacyModulePaths: ["./availables/mitosis.ts"],
    requiredEnv: ["API_URL", "EVM_API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["RPC_URL", "EXISTING_METRICS_URL", "DECIMAL_PLACES"],
    factory: createFactory(Mitosis),
  },
  {
    id: "mitosis-testnet",
    family: "hybrid",
    description: "Mitosis testnet collector",
    aliases: ["testnet/mitosis"],
    legacyModulePaths: ["./availables/testnet/mitosis.ts"],
    requiredEnv: ["EVM_API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES"],
    factory: createFactory(MitosisTestnet),
  },
  {
    id: "story-testnet",
    family: "evm",
    description: "Story testnet collector",
    aliases: ["testnet/story"],
    legacyModulePaths: ["./availables/testnet/story.ts"],
    requiredEnv: ["EVM_API_URL", "COLLECTOR_ADDRESSES"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES"],
    factory: createFactory(StoryTestnet),
  },
  {
    id: "canopy-testnet",
    family: "hybrid",
    description: "Canopy testnet collector",
    aliases: ["testnet/canopy"],
    legacyModulePaths: ["./availables/testnet/canopy.ts"],
    requiredEnv: ["API_URL", "COLLECTOR_ADDRESSES", "COLLECTOR_VALIDATOR"],
    optionalEnv: ["EXISTING_METRICS_URL", "DECIMAL_PLACES"],
    factory: createFactory(CanopyTestnet),
  },
];

export function listChainProfiles(): ChainProfile[] {
  return [...CHAIN_PROFILES];
}

export function findChainProfileByLegacyModulePath(modulePath: string): ChainProfile | undefined {
  const normalized = normalizeChainToken(modulePath);

  return CHAIN_PROFILES.find((profile) =>
    profile.legacyModulePaths.some((entry) => normalizeChainToken(entry) === normalized),
  );
}

export function resolveChainProfile(input: string): ChainProfile {
  const normalized = normalizeChainToken(input);

  const directMatch = CHAIN_PROFILES.find((profile) => {
    if (normalizeChainToken(profile.id) === normalized) {
      return true;
    }

    return profile.aliases.some((alias) => normalizeChainToken(alias) === normalized);
  });

  if (directMatch) {
    return directMatch;
  }

  const legacyMatch = findChainProfileByLegacyModulePath(input);
  if (legacyMatch) {
    return legacyMatch;
  }

  const supported = CHAIN_PROFILES.map((profile) => profile.id).join(", ");
  throw new Error(`Unsupported chain "${input}". Supported CHAIN values: ${supported}`);
}

export function createCollector(context: CollectorContext) {
  return resolveChainProfile(context.config.chainId).factory(context);
}
