import type * as express from "express";
import CachedHttpClient from "./core/http/cached-http-client";

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
   * 1분 캐시가 적용된 GET 요청 함수. 모든 하위 클래스에서 사용 가능.
   * 캐시가 있으면 (만료되었어도) 즉시 반환하고 백그라운드에서 갱신 시도.
   * 캐시 우선 전략으로 대부분 즉시 반환되므로 타임아웃은 선택적.
   * @param url 요청 URL
   * @param process 응답 처리 함수
   * @param cacheDurationMs 캐시 유지 시간(ms), 기본 1분
   * @param timeoutMs 요청 타임아웃(ms), undefined면 타임아웃 없음
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
   * 랜덤 캐시 지속시간을 제공하여 동시 요청을 분산시키는 헬퍼 메서드
   * @param baseDurationMs 기본 캐시 지속시간(ms)
   * @param varianceMs 랜덤 분산 범위(ms), 기본 10000 (10초)
   * @returns 랜덤 캐시 지속시간
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

  /**
   * 1분 캐시가 적용된 POST 요청 함수. JSON-RPC({ method, params }) 또는 일반 JSON 바디 모두 지원.
   * 캐시가 있으면 (만료되었어도) 즉시 반환하고 백그라운드에서 갱신 시도.
   * 캐시 우선 전략으로 대부분 즉시 반환되므로 타임아웃은 선택적.
   * @param url 요청 URL
   * @param data JSON-RPC({ method, params }) 또는 일반 JSON 객체 바디
   * @param process 응답 처리 함수
   * @param cacheDurationMs 캐시 유지 시간(ms), 기본 1분
   * @param timeoutMs 요청 타임아웃(ms), undefined면 타임아웃 없음
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
   * 변하지 않는 응답(JSON-RPC getBlock 등)에 대한 LRU 기반 무기한 캐시.
   * - 히트 시 네트워크 요청 없이 메모리에서 반환
   * - 용량 초과 시 가장 오래 사용되지 않은 항목부터 제거하여 메모리 릭 방지
   * @param url 요청 URL
   * @param data JSON-RPC({ method, params }) 또는 일반 JSON 객체 바디
   * @param process 응답 처리 함수
   * @param maxEntries LRU 최대 엔트리 수 (기본 5000)
   * @param timeoutMs 요청 타임아웃(ms), undefined면 타임아웃 없음
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

  protected async loadExistMetrics(): Promise<string> {
    if (this.existMetrics) {
      return (
        await Promise.all(
          this.existMetrics.split(",").map(async (url: string) => {
            return this.get(url, (response) => {
              let currentResponse = response.data;
              currentResponse = currentResponse.replaceAll("cometbft", "tendermint");
              return currentResponse;
            });
          }),
        )
      ).join("\n");
    } else {
      return "";
    }
  }
}
