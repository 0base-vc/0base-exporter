import { enablePromClientGaugeTiming } from "../lib/prom-perf";
import Server from "../server";
import { loadRuntimeConfig } from "./config";
import {
  createCollector,
  CUSTOM_BLOCKCHAIN_CHAIN_ID,
  resolveChainProfile,
} from "./collector-registry";
import { logger } from "./logger";

export async function bootstrap() {
  const config = loadRuntimeConfig();
  const profile =
    config.chainId === CUSTOM_BLOCKCHAIN_CHAIN_ID ? undefined : resolveChainProfile(config.chainId);

  if (config.enablePromPerf) {
    enablePromClientGaugeTiming();
  }

  logger.info("Starting exporter", {
    chain: config.chainId,
    chainSource: config.chainSource,
    family: profile?.family ?? "custom",
    promPerf: config.enablePromPerf,
  });

  const collector = createCollector({ config, logger });
  const server = new Server({ collector, logger });

  return server.start(config.port);
}
