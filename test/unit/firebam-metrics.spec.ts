import axios from "axios";
import { readFileSync } from "fs";
import { resolve } from "path";
import FirebamMetrics from "../../src/availables/shared/firebam-metrics";
import { loadRuntimeConfig } from "../../src/core/config";
import { createCollector } from "../../src/core/collector-registry";
import { logger } from "../../src/core/logger";
import { register } from "prom-client";

jest.mock("axios");

const nativeMetrics = readFileSync(resolve(__dirname, "../fixtures/firebam.prom"), "utf8");
const url = "http://firebam.example:27770/metrics";

describe("FireBAM native metrics", () => {
  const mockedAxios = jest.mocked(axios);

  beforeEach(() => {
    register.clear();
    mockedAxios.get.mockReset();
  });

  it("does nothing when the optional endpoint is unset", async () => {
    expect(await new FirebamMetrics().collect()).toBe("");
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("preserves native names, labels, types and values without renaming counters", async () => {
    mockedAxios.get.mockResolvedValue({ data: nativeMetrics });
    const result = await new FirebamMetrics(url).collect();
    expect(result).toContain(nativeMetrics);
    expect(result).toContain("solana_firebam_metrics_up 1\n");
    expect(mockedAxios.get).toHaveBeenCalledWith(url, { timeout: 4000 });
  });

  it("never replays healthy metrics after a failed scrape and can recover", async () => {
    const collector = new FirebamMetrics(url);
    mockedAxios.get
      .mockResolvedValueOnce({ data: nativeMetrics })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ data: nativeMetrics.replace("} 1234", "} 1235") });
    expect(await collector.collect()).toContain("solana_firebam_metrics_up 1");
    const failed = await collector.collect();
    expect(failed).toContain("solana_firebam_metrics_up 0");
    expect(failed).not.toContain("bam_healthy");
    expect(await collector.collect()).toContain(
      'bam_transaction_published_total{kind="bam",kind_id="0"} 1235',
    );
  });

  it.each([
    "",
    "<html>error</html>",
    { error: "not metrics" },
    "other_metric 1\n",
    "bam_enabled 1\n<html>error</html>\n",
  ])("rejects a successful HTTP response that is not a FireBAM endpoint: %p", async (body) => {
    mockedAxios.get.mockResolvedValue({ data: body });
    expect(await new FirebamMetrics(url).collect()).toMatch(/solana_firebam_metrics_up 0\n$/);
  });

  it("rejects an exporter response to prevent recursive ingestion", async () => {
    mockedAxios.get.mockResolvedValue({ data: `${nativeMetrics}\nsolana_firebam_metrics_up 1\n` });
    const result = await new FirebamMetrics(url).collect();
    expect(result).not.toContain("bam_enabled");
    expect(result).toContain("solana_firebam_metrics_up 0");
  });

  it("deduplicates simultaneous requests without caching later scrapes", async () => {
    mockedAxios.get.mockImplementation(async () => {
      await new Promise((done) => setTimeout(done, 10));
      return { data: nativeMetrics };
    });
    const collector = new FirebamMetrics(url);
    await Promise.all([collector.collect(), collector.collect()]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    await collector.collect();
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it.each([
    "file:///tmp/metrics",
    "not-a-url",
    "http://localhost:27770/metrics",
    "http://127.0.0.1:27770/metrics",
    "http://[::1]:27770/metrics",
  ])("rejects invalid or local self-scraping endpoints: %s", (endpoint) =>
    expect(() => new FirebamMetrics(endpoint, 27770)).toThrow(/FIREBAM_METRICS_URL/),
  );

  it("allows local FireBAM on a different port and remote nodes on the same port", () => {
    expect(() => new FirebamMetrics("http://127.0.0.1:27770/metrics", 27771)).not.toThrow();
    expect(() => new FirebamMetrics(url, 27770)).not.toThrow();
  });

  it.each([
    { CHAIN: "solana" },
    { CHAIN: "solana-testnet" },
    { BLOCKCHAIN: "./availables/solana.ts" },
    { BLOCKCHAIN: "./availables/testnet/solana.ts" },
  ])(
    "wires optional FireBAM collection into %p and excludes duplicate legacy input",
    async (selection) => {
      const collector = createCollector({
        config: loadRuntimeConfig({
          ...selection,
          RPC_URL: "http://rpc.example",
          VOTE: "vote-1",
          IDENTITY: "identity-1",
          FIREBAM_METRICS_URL: url,
          EXISTING_METRICS_URL: `${url},http://other.example/metrics`,
        }),
        logger,
      });
      for (const method of [
        "updateVoteAccounts",
        "updateBalance",
        "updateDelegationsFromJPool",
        "updatePendingStakeFromJPool",
        "updateMarinadeScoring",
        "updateMarinadeSelectBonds",
        "updateGlobalEffectiveBid",
        "updateClusterRequiredVersions",
        "updateValidatorReleaseVersions",
        "updateLeaderWindowsAndEpochEnd",
        "updateMarinadeEffectiveBidEpoch",
        "updateCurrentEpochMetrics",
        "updateEpochMedianFeesAverages",
        "updateOnboardingPriority",
        "updateTvcDeltas",
      ]) {
        Object.defineProperty(collector, method, {
          value: jest.fn().mockResolvedValue(undefined),
          configurable: true,
        });
      }
      mockedAxios.get.mockImplementation(async (endpoint) => ({
        data: endpoint === url ? nativeMetrics : "other_metric 7\n",
      }));
      const result = await collector.makeMetrics();
      expect(result).toContain("solana_firebam_metrics_up 1");
      expect(result).toContain("other_metric 7");
      expect(result.match(/^bam_enabled\{/gm)).toHaveLength(1);
      expect(mockedAxios.get.mock.calls.filter(([endpoint]) => endpoint === url)).toHaveLength(1);

      const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
      mockedAxios.get.mockRejectedValue(new Error("native down"));
      const failed = await collector.makeMetrics();
      expect(failed).toContain("solana_firebam_metrics_up 0");
      expect(failed).not.toContain("bam_healthy");

      // An ordinary RPC failure cannot remove FireBAM scrape health.
      Object.defineProperty(collector, "updateVoteAccounts", {
        value: jest.fn().mockRejectedValue(new Error("rpc down")),
      });
      mockedAxios.get.mockResolvedValue({ data: nativeMetrics });
      expect(await collector.makeMetrics()).toContain("solana_firebam_metrics_up 1");
      errorLog.mockRestore();
    },
  );

  it("passes the configured exporter port to local endpoint validation", () => {
    const config = loadRuntimeConfig({
      CHAIN: "solana",
      PORT: "27771",
      RPC_URL: "http://rpc.example",
      VOTE: "vote-1",
      IDENTITY: "identity-1",
      FIREBAM_METRICS_URL: "http://127.0.0.1:27770/metrics",
    });
    expect(() => createCollector({ config, logger })).not.toThrow();
  });
});
