import express from "express";
import morgan from "morgan";
import type { Logger } from "./core/logger";
import type { Express, NextFunction, Request, Response } from "express";
import type * as http from "http";
import type TargetAbstract from "./target.abstract";

export default class Server {
  private readonly app: Express;
  private server?: http.Server;

  public constructor(
    private readonly deps: {
      collector: TargetAbstract;
      logger: Logger;
    },
  ) {
    this.app = express();
  }

  public async setup(): Promise<void> {
    this.app.use(morgan("combined"));
    this.app.get("/healthz", (_request: Request, response: Response) => {
      response.status(200).json({ ok: true });
    });
    this.app.get("/metrics", this.deps.collector.metrics());
    this.app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
      this.deps.logger.error("Request failed", {
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      response.status(500).type("text/plain").send("metrics collection failed");
    });
  }

  public async start(port: number | string): Promise<{ server: http.Server; port: string }> {
    await this.setup();
    await this.deps.collector.start();

    return new Promise((resolve, reject) => {
      const server = this.app.listen(port);
      this.server = server;

      const onError = (error: Error) => {
        server.off("listening", onListening);
        this.server = undefined;
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        const actualPort =
          typeof address === "object" && address !== null ? String(address.port) : String(port);
        resolve({ server, port: actualPort });
      };

      server.once("error", onError);
      server.once("listening", onListening);
    });
  }

  public async close(): Promise<void> {
    await this.deps.collector.stop();
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}
