import type * as express from "express";
import CachedHttpClient from "./core/http/cached-http-client";

const PHAROS_LEGACY_METRIC_PREFIX = "mytumbler_";
const PHAROS_METRIC_PREFIX = "multi_proposer_consensus_";

const METRIC_NAME_PATTERN = "[a-zA-Z_:][a-zA-Z0-9_:]*";

function normalizeMetricIdentifier(identifier: string): string {
  if (!identifier.startsWith(PHAROS_LEGACY_METRIC_PREFIX)) return identifier;

  return `${PHAROS_METRIC_PREFIX}${identifier.slice(PHAROS_LEGACY_METRIC_PREFIX.length)}`;
}

function normalizeExistingMetrics(metrics: string): string {
  const metadataPattern = new RegExp(
    `^(#\\s+(?:HELP|TYPE|UNIT)\\s+)(${METRIC_NAME_PATTERN})(?=\\s|$)`,
  );
  const samplePattern = new RegExp(`^(${METRIC_NAME_PATTERN})(?=\\{|[\\t ]|$)`);

  return (
    metrics
      // Preserve the pre-existing exporter behavior for CometBFT's metric and
      // label text while keeping the newer Pharos mapping identifier-scoped.
      .split("cometbft")
      .join("tendermint")
      .split("\n")
      .map((line: string) => {
        const metadataMatch = line.match(metadataPattern);
        if (metadataMatch) {
          return line.replace(
            metadataPattern,
            (_match: string, prefix: string, identifier: string) =>
              `${prefix}${normalizeMetricIdentifier(identifier)}`,
          );
        }

        return line.replace(samplePattern, (identifier: string) =>
          normalizeMetricIdentifier(identifier),
        );
      })
      .join("\n")
  );
}

export default abstract class TargetAbstract {
  abstract makeMetrics(): Promise<string>;

  private readonly httpClient = new CachedHttpClient();

  protected constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly addresses: string,
    protected readonly validator: string,
  ) {}

  public async start(): Promise<void> {
    // Default no-op. Collectors can override when they manage background state.
  }

  public async stop(): Promise<void> {
    // Default no-op. Collectors can override when they manage background state.
  }

  public metrics(): express.RequestHandler {
    return async (_req, response, next) => {
      try {
        response.setHeader("Content-Type", "text/plain");
        response.send(await this.makeMetrics());
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Cached GET helper available to all collectors.
   * Returns cached data immediately, even when stale, and refreshes it in the background.
   * Timeout is optional because the cache-first strategy usually serves the response immediately.
   * @param url Request URL
   * @param process Response transform function
   * @param cacheDurationMs Cache TTL in milliseconds, defaults to 1 minute
   * @param timeoutMs Request timeout in milliseconds, or undefined for no timeout
   */
  protected async getWithCache(
    url: string,
    process: (response: { data: any }) => any,
    cacheDurationMs: number = 60000,
    timeoutMs?: number,
  ) {
    return this.httpClient.getWithCache(url, process, cacheDurationMs, timeoutMs);
  }

  /**
   * Returns a randomized cache duration to spread concurrent refreshes.
   * @param baseDurationMs Base cache duration in milliseconds
   * @param varianceMs Random variance range in milliseconds, defaults to 10 seconds
   * @returns Randomized cache duration
   */
  protected getRandomCacheDuration(
    baseDurationMs: number = 60000,
    varianceMs: number = 10000,
  ): number {
    const randomOffset = Math.random() * varianceMs - varianceMs / 2;
    return Math.max(baseDurationMs + randomOffset, baseDurationMs / 2);
  }

  protected async get(url: string, process: (response: { data: any }) => any, timeoutMs?: number) {
    return this.httpClient.get(url, process, timeoutMs);
  }

  /** Strict GET helper for health checks; it never returns a stale fallback value. */
  protected async getFresh(
    url: string,
    process: (response: { data: any }) => any,
    timeoutMs?: number,
  ) {
    return this.httpClient.getFresh(url, process, timeoutMs);
  }

  protected normalizeExistingMetrics(metrics: string): string {
    return normalizeExistingMetrics(metrics);
  }

  /**
   * Cached POST helper supporting both JSON-RPC payloads and plain JSON bodies.
   * Returns cached data immediately, even when stale, and refreshes it in the background.
   * Timeout is optional because the cache-first strategy usually serves the response immediately.
   * @param url Request URL
   * @param data JSON-RPC({ method, params }) or a plain JSON payload
   * @param process Response transform function
   * @param cacheDurationMs Cache TTL in milliseconds, defaults to 1 minute
   * @param timeoutMs Request timeout in milliseconds, or undefined for no timeout
   */
  protected async postWithCache(
    url: string,
    data: any,
    process: (response: { data: any }) => any,
    cacheDurationMs: number = 60000,
    timeoutMs?: number,
  ) {
    return this.httpClient.postWithCache(url, data, process, cacheDurationMs, timeoutMs);
  }

  /**
   * LRU-backed indefinite cache for immutable responses such as JSON-RPC `getBlock`.
   * - Cache hits are served from memory without a network request
   * - Oldest entries are evicted once capacity is exceeded to avoid unbounded growth
   * @param url Request URL
   * @param data JSON-RPC({ method, params }) or a plain JSON payload
   * @param process Response transform function
   * @param maxEntries Maximum LRU entries, defaults to 5000
   * @param timeoutMs Request timeout in milliseconds, or undefined for no timeout
   */
  protected async postImmutableWithLRU(
    url: string,
    data: any,
    process: (response: { data: any }) => any,
    maxEntries?: number,
    isCacheable?: (result: any) => boolean,
    timeoutMs?: number,
  ) {
    return this.httpClient.postImmutableWithLRU(
      url,
      data,
      process,
      maxEntries,
      isCacheable,
      timeoutMs,
    );
  }

  protected async post(
    url: string,
    data: { method: string; params?: unknown[] },
    process: (response: { data: any }) => any,
    timeoutMs?: number,
  ) {
    return this.httpClient.post(url, data, process, timeoutMs);
  }

  /**
   * Strict JSON-RPC POST helper for health and consensus checks. Unlike
   * `post`, it never returns a cached success after the upstream request
   * fails, so an exporter scrape cannot report stale node health.
   */
  protected async postFresh(
    url: string,
    data: { method: string; params?: unknown[] },
    process: (response: { data: any }) => any,
    timeoutMs: number,
  ) {
    return this.httpClient.postFresh(url, data, process, timeoutMs);
  }

  protected async loadExistMetrics(): Promise<string> {
    if (this.existMetrics) {
      const urls = this.existMetrics
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);

      return (
        await Promise.all(
          urls.map(async (url: string) => {
            return this.get(url, (response) => {
              return this.normalizeExistingMetrics(String(response.data));
            });
          }),
        )
      ).join("\n");
    } else {
      return "";
    }
  }
}
