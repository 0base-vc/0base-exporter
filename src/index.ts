import { bootstrap } from "./core/bootstrap";
import { logger } from "./core/logger";

process.on("uncaughtException", (error) => {
  logger.error("uncaughtException", {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  logger.error("unhandledRejection", {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exit(1);
});

void bootstrap()
  .then(({ server, port }) => {
    if (server.listening) {
      logger.info("Exporter listening", { port });
    }
  })
  .catch((error) => {
    logger.error("Failed to bootstrap exporter", {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    process.exit(1);
  });
