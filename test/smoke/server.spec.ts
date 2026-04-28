import request from "supertest";
import Server from "../../src/server";
import TargetAbstract from "../../src/target.abstract";
import { logger } from "../../src/core/logger";

class StaticCollector extends TargetAbstract {
  public started = false;
  public stopped = false;

  public constructor() {
    super("", "", "", "", "");
  }

  public async start(): Promise<void> {
    this.started = true;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
  }

  public async makeMetrics(): Promise<string> {
    return "# HELP static_metric Static metric\n# TYPE static_metric gauge\nstatic_metric 1\n";
  }
}

class FailingCollector extends TargetAbstract {
  public constructor() {
    super("", "", "", "", "");
  }

  public async makeMetrics(): Promise<string> {
    throw new Error("boom");
  }
}

describe("Server smoke tests", () => {
  it("serves health and metrics endpoints and runs collector lifecycle hooks", async () => {
    const collector = new StaticCollector();
    const server = new Server({ collector, logger });
    const { server: httpServer } = await server.start(0);

    await request(httpServer).get("/healthz").expect(200, { ok: true });

    const metricsResponse = await request(httpServer).get("/metrics").expect(200);
    expect(metricsResponse.text).toContain("static_metric 1");
    expect(collector.started).toBe(true);

    await server.close();
    expect(collector.stopped).toBe(true);
  });

  it("returns 500 when collection fails", async () => {
    const collector = new FailingCollector();
    const server = new Server({ collector, logger });
    const { server: httpServer } = await server.start(0);

    const response = await request(httpServer).get("/metrics").expect(500);
    expect(response.text).toContain("metrics collection failed");

    await server.close();
  });
});
