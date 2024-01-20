import * as express from 'express';
import axios from "axios";

export default abstract class TargetAbstract {
    abstract makeMetrics(): Promise<string>;

    protected constructor(protected readonly existMetrics: string,
                          protected readonly apiUrl: string,
                          protected readonly address: string,
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

    protected readonly cache = {};

    protected async get(url: string, process: (response: { data: any }) => any) {
        return axios.get(url).then(response => {
            const result = process(response);
            this.cache[url] = result;
            return result;
        }).catch((e) => {
            console.error('get', e);

            const result = this.cache[url];
            if (result === undefined)
                return '';
            else
                return result;
        });
    }


    protected async post(url: string, data: { method: string, params?: string[] }, process: (response: { data: any }) => any) {
        const key = data.method;
        return axios.post(url, {jsonrpc: '2.0', id: 1, method: data.method, params: data.params}).then(response => {
            const result = process(response);
            this.cache[key] = result;
            return result;
        }).catch((e) => {
            console.error('post', e);

            const result = this.cache[key];
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