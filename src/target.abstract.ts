import * as express from 'express';
import axios from "axios";

export default abstract class TargetAbstract {
    abstract makeMetrics(): Promise<string>;

    protected constructor(protected readonly existMetrics: string,
                          protected readonly apiUrl: string,
                          protected readonly rpcUrl: string,
                          protected readonly addresses: string,
                          protected readonly validator: string) {
    }

    public async metrics(): Promise<express.RequestHandler> {
        return async (_req, response, next) => {
            return (async () => {
                response.setHeader('Content-Type', 'text/plain');
                response.send(await this.makeMetrics());

                next();
            })();

        };
    }

    private getCache: { [key: string]: any } = {};
    private getCacheTimestamps: { [key: string]: number } = {};
    private fallbackGetResult: { [key: string]: any } = {};

    /**
     * 1분 캐시가 적용된 GET 요청 함수. 모든 하위 클래스에서 사용 가능.
     * @param url 요청 URL
     * @param process 응답 처리 함수
     * @param cacheDurationMs 캐시 유지 시간(ms), 기본 1분
     */
    protected async getWithCache(
        url: string,
        process: (response: { data: any }) => any,
        cacheDurationMs: number = 60000
    ) {
        const now = Date.now();
        if (
            this.getCache[url] !== undefined &&
            this.getCacheTimestamps[url] !== undefined &&
            now - this.getCacheTimestamps[url] < cacheDurationMs
        ) {
            return this.getCache[url];
        }
        try {
            const response = await axios.get(url);
            const result = process(response);
            this.getCache[url] = result;
            this.getCacheTimestamps[url] = now;
            return result;
        } catch (e) {
            console.error('getWithCache', e);
            if (this.getCache[url] !== undefined) {
                return this.getCache[url];
            }
            return '';
        }
    }

    /**
     * 랜덤 캐시 지속시간을 제공하여 동시 요청을 분산시키는 헬퍼 메서드
     * @param baseDurationMs 기본 캐시 지속시간(ms)
     * @param varianceMs 랜덤 분산 범위(ms), 기본 10000 (10초)
     * @returns 랜덤 캐시 지속시간
     */
    protected getRandomCacheDuration(baseDurationMs: number = 60000, varianceMs: number = 10000): number {
        const randomOffset = Math.random() * varianceMs - (varianceMs / 2);
        return Math.max(baseDurationMs + randomOffset, baseDurationMs / 2);
    }

    protected async get(url: string, process: (response: { data: any }) => any) {
        const fallbackKey = url;
        return axios.get(url).then(response => {
            const result = process(response);
            this.fallbackGetResult[fallbackKey] = result;
            return result;
        }).catch((e) => {
            console.error('get', e);

            const result = this.fallbackGetResult[fallbackKey];
            if (result === undefined)
                return '';
            else
                return result;
        });
    }


    private postCache: { [key: string]: any } = {};
    private postCacheTimestamps: { [key: string]: number } = {};

    /**
     * 1분 캐시가 적용된 POST 요청 함수. JSON-RPC({ method, params }) 또는 일반 JSON 바디 모두 지원.
     * @param url 요청 URL
     * @param data JSON-RPC({ method, params }) 또는 일반 JSON 객체 바디
     * @param process 응답 처리 함수
     * @param cacheDurationMs 캐시 유지 시간(ms), 기본 1분
     */
    protected async postWithCache(
        url: string,
        data: any,
        process: (response: { data: any }) => any,
        cacheDurationMs: number = 60000
    ) {
        const key = url + ':' + JSON.stringify(data);
        const now = Date.now();
        if (
            this.postCache[key] !== undefined &&
            this.postCacheTimestamps[key] !== undefined &&
            now - this.postCacheTimestamps[key] < cacheDurationMs
        ) {
            return this.postCache[key];
        }
        try {
            const isJsonRpc = data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'method');
            const body = isJsonRpc
                ? { jsonrpc: '2.0', id: 1, method: data.method, params: data.params }
                : data;
            const response = await axios.post(url, body);
            const result = process(response);
            this.postCache[key] = result;
            this.postCacheTimestamps[key] = now;
            return result;
        } catch (e) {
            console.error('postWithCache', e);
            if (this.postCache[key] !== undefined) {
                return this.postCache[key];
            }
            return '';
        }
    }

    // -------------------------- Immutable POST LRU cache --------------------------
    private immutablePostLRU: Map<string, any> = new Map();
    private immutablePostLRUMaxEntries: number = 5000;

    /**
     * 변하지 않는 응답(JSON-RPC getBlock 등)에 대한 LRU 기반 무기한 캐시.
     * - 히트 시 네트워크 요청 없이 메모리에서 반환
     * - 용량 초과 시 가장 오래 사용되지 않은 항목부터 제거하여 메모리 릭 방지
     * @param url 요청 URL
     * @param data JSON-RPC({ method, params }) 또는 일반 JSON 객체 바디
     * @param process 응답 처리 함수
     * @param maxEntries LRU 최대 엔트리 수 (기본 5000)
     */
    protected async postImmutableWithLRU(
        url: string,
        data: any,
        process: (response: { data: any }) => any,
        maxEntries?: number,
        isCacheable?: (result: any) => boolean
    ) {
        const key = url + ':' + JSON.stringify(data);
        if (this.immutablePostLRU.has(key)) {
            const cached = this.immutablePostLRU.get(key);
            // LRU 갱신: 삭제 후 재삽입으로 최신 사용 처리
            this.immutablePostLRU.delete(key);
            this.immutablePostLRU.set(key, cached);
            return cached;
        }
        try {
            const isJsonRpc = data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'method');
            const body = isJsonRpc
                ? { jsonrpc: '2.0', id: 1, method: data.method, params: data.params }
                : data;
            const response = await axios.post(url, body);
            const result = process(response);
            // 캐시 가능 판정: 기본은 undefined/null/NaN(숫자) 는 캐시하지 않음
            const defaultCacheable = (val: any) => {
                if (val === undefined || val === null) return false;
                if (typeof val === 'number' && !Number.isFinite(val)) return false;
                return true;
            };
            const canCache = isCacheable ? isCacheable(result) : defaultCacheable(result);
            if (!canCache) {
                return result;
            }
            this.immutablePostLRU.set(key, result);
            const limit = Number.isFinite(maxEntries as number) && (maxEntries as number)! > 0
                ? (maxEntries as number)
                : this.immutablePostLRUMaxEntries;
            // 용량 초과 시 가장 오래된 항목부터 제거
            while (this.immutablePostLRU.size > limit) {
                const oldestKey = this.immutablePostLRU.keys().next().value;
                this.immutablePostLRU.delete(oldestKey);
            }
            return result;
        } catch (e) {
            console.error('postImmutableWithLRU', e);
            if (this.immutablePostLRU.has(key)) {
                return this.immutablePostLRU.get(key);
            }
            return '';
        }
    }

    private fallbackPostResult: { [key: string]: any } = {};

    protected async post(url: string, data: { method: string, params?: string[] }, process: (response: {
        data: any
    }) => any) {
        const fallbackKey = JSON.stringify(data);
        //const fallbackKey = data.method + data.params && data.params.length >= 0 ? data.params.join(',') : '';
        return axios.post(url, {jsonrpc: '2.0', id: 1, method: data.method, params: data.params}).then(response => {
            const result = process(response);
            this.fallbackPostResult[fallbackKey] = result;
            return result;
        }).catch((e) => {
            console.error('post', e);

            const result = this.fallbackPostResult[fallbackKey];
            if (result === undefined)
                return '';
            else
                return result;
        });
    }

    protected async loadExistMetrics(): Promise<string> {
        if (this.existMetrics) {
            return (await Promise.all(this.existMetrics.split(',').map(async (url:string) => {
                return this.get(url, response => {
                    let currentResponse = response.data;
                    currentResponse = currentResponse.replaceAll('cometbft', 'tendermint');
                    return currentResponse;
                });
            }))).join('\n');
        } else {
            return '';
        }
    }
}