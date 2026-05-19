import axios, { type AxiosRequestConfig } from "axios";

type HttpResponse = { data: unknown };
type ResponseTransform<T> = (response: HttpResponse) => T | Promise<T>;

interface TimedCacheEntry {
  value: unknown;
  timestamp: number;
}

function isJsonRpcPayload(data: unknown): data is { method: string; params?: unknown[] } {
  return typeof data === "object" && data !== null && "method" in data;
}

export default class CachedHttpClient {
  private readonly getCache = new Map<string, TimedCacheEntry>();
  private readonly fallbackGetResults = new Map<string, unknown>();
  private readonly postCache = new Map<string, TimedCacheEntry>();
  private readonly fallbackPostResults = new Map<string, unknown>();
  private readonly immutablePostLRU = new Map<string, unknown>();
  private readonly inFlightRequests = new Map<string, Promise<unknown>>();
  private readonly immutablePostLRUMaxEntries = 5000;

  public async get<T>(
    url: string,
    transform: ResponseTransform<T>,
    timeoutMs?: number,
  ): Promise<T | ""> {
    const requestKey = `GET:${url}`;

    try {
      return await this.runWithDeduplication(requestKey, async () => {
        const response = await axios.get(url, this.createConfig(timeoutMs));
        const result = await transform(response);
        this.fallbackGetResults.set(url, result);
        return result;
      });
    } catch (error) {
      console.error("get", error);
      return (this.fallbackGetResults.get(url) as T | undefined) ?? "";
    }
  }

  public async getWithCache<T>(
    url: string,
    transform: ResponseTransform<T>,
    cacheDurationMs: number = 60000,
    timeoutMs?: number,
  ): Promise<T | ""> {
    const cached = this.getCache.get(url);
    const now = Date.now();

    if (cached && now - cached.timestamp < cacheDurationMs) {
      return cached.value as T;
    }

    if (cached) {
      void this.refreshInBackground(`GET:${url}`, async () => {
        const response = await axios.get(url, this.createConfig(timeoutMs));
        const result = await transform(response);
        this.getCache.set(url, { value: result, timestamp: Date.now() });
        this.fallbackGetResults.set(url, result);
      });

      return cached.value as T;
    }

    try {
      return await this.runWithDeduplication(`GET:${url}`, async () => {
        const response = await axios.get(url, this.createConfig(timeoutMs));
        const result = await transform(response);
        this.getCache.set(url, { value: result, timestamp: Date.now() });
        this.fallbackGetResults.set(url, result);
        return result;
      });
    } catch (error) {
      console.error("getWithCache", error);
      return (this.fallbackGetResults.get(url) as T | undefined) ?? "";
    }
  }

  public async post<T>(
    url: string,
    data: { method: string; params?: unknown[] } | Record<string, unknown>,
    transform: ResponseTransform<T>,
    timeoutMs?: number,
  ): Promise<T | ""> {
    const fallbackKey = JSON.stringify(data);
    const requestKey = `POST:${url}:${fallbackKey}`;

    try {
      return await this.runWithDeduplication(requestKey, async () => {
        const response = await axios.post(
          url,
          this.buildPostBody(data),
          this.createConfig(timeoutMs),
        );
        const result = await transform(response);
        this.fallbackPostResults.set(fallbackKey, result);
        return result;
      });
    } catch (error) {
      console.error("post", error);
      return (this.fallbackPostResults.get(fallbackKey) as T | undefined) ?? "";
    }
  }

  public async postWithCache<T>(
    url: string,
    data: unknown,
    transform: ResponseTransform<T>,
    cacheDurationMs: number = 60000,
    timeoutMs?: number,
  ): Promise<T | ""> {
    const key = `${url}:${JSON.stringify(data)}`;
    const cached = this.postCache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < cacheDurationMs) {
      return cached.value as T;
    }

    if (cached) {
      void this.refreshInBackground(`POST:${key}`, async () => {
        const response = await axios.post(
          url,
          this.buildPostBody(data),
          this.createConfig(timeoutMs),
        );
        const result = await transform(response);
        this.postCache.set(key, { value: result, timestamp: Date.now() });
        this.fallbackPostResults.set(key, result);
      });

      return cached.value as T;
    }

    try {
      return await this.runWithDeduplication(`POST:${key}`, async () => {
        const response = await axios.post(
          url,
          this.buildPostBody(data),
          this.createConfig(timeoutMs),
        );
        const result = await transform(response);
        this.postCache.set(key, { value: result, timestamp: Date.now() });
        this.fallbackPostResults.set(key, result);
        return result;
      });
    } catch (error) {
      console.error("postWithCache", error);
      return (this.fallbackPostResults.get(key) as T | undefined) ?? "";
    }
  }

  public async postImmutableWithLRU<T>(
    url: string,
    data: unknown,
    transform: ResponseTransform<T>,
    maxEntries?: number,
    isCacheable?: (result: T) => boolean,
    timeoutMs?: number,
  ): Promise<T | ""> {
    const key = `${url}:${JSON.stringify(data)}`;
    const cached = this.immutablePostLRU.get(key);

    if (cached !== undefined) {
      this.immutablePostLRU.delete(key);
      this.immutablePostLRU.set(key, cached);
      return cached as T;
    }

    try {
      return await this.runWithDeduplication(`IMMUTABLE:${key}`, async () => {
        const response = await axios.post(
          url,
          this.buildPostBody(data),
          this.createConfig(timeoutMs),
        );
        const result = await transform(response);
        const canCache = isCacheable ? isCacheable(result) : this.defaultCacheable(result);

        if (canCache) {
          this.immutablePostLRU.set(key, result);
          this.pruneImmutableCache(maxEntries);
        }

        return result;
      });
    } catch (error) {
      console.error("postImmutableWithLRU", error);
      return (this.immutablePostLRU.get(key) as T | undefined) ?? "";
    }
  }

  private async runWithDeduplication<T>(key: string, action: () => Promise<T>): Promise<T> {
    const existing = this.inFlightRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const pending = action().finally(() => {
      this.inFlightRequests.delete(key);
    });

    this.inFlightRequests.set(key, pending as Promise<unknown>);

    return pending;
  }

  private async refreshInBackground(key: string, action: () => Promise<void>): Promise<void> {
    if (this.inFlightRequests.has(key)) {
      return;
    }

    try {
      await this.runWithDeduplication(key, action);
    } catch {
      // Ignore stale refresh failures.
    }
  }

  private pruneImmutableCache(maxEntries?: number): void {
    const limit =
      typeof maxEntries === "number" && Number.isFinite(maxEntries) && maxEntries > 0
        ? maxEntries
        : this.immutablePostLRUMaxEntries;

    while (this.immutablePostLRU.size > limit) {
      const oldestKey = this.immutablePostLRU.keys().next().value;
      if (!oldestKey) {
        return;
      }

      this.immutablePostLRU.delete(oldestKey);
    }
  }

  private defaultCacheable<T>(value: T): boolean {
    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === "number" && !Number.isFinite(value)) {
      return false;
    }

    return true;
  }

  private buildPostBody(data: unknown): unknown {
    if (isJsonRpcPayload(data)) {
      return {
        jsonrpc: "2.0",
        id: 1,
        method: data.method,
        params: data.params,
      };
    }

    return data;
  }

  private createConfig(timeoutMs?: number): AxiosRequestConfig {
    if (timeoutMs === undefined) {
      return {};
    }

    return { timeout: timeoutMs };
  }
}
