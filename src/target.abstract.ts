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
     * 1분 캐시가 적용된 POST 요청 함수. 모든 하위 클래스에서 사용 가능.
     * @param url 요청 URL
     * @param data { method, params }
     * @param process 응답 처리 함수
     * @param cacheDurationMs 캐시 유지 시간(ms), 기본 1분
     */
    protected async postWithCache(
        url: string,
        data: { method: string, params?: string[] },
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
            const response = await axios.post(url, {
                jsonrpc: '2.0',
                id: 1,
                method: data.method,
                params: data.params,
            });
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