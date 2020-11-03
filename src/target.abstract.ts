import * as express from 'express';

export default abstract class TargetAbstract {
    abstract async makeMetrics(): Promise<string>;

    public async metrics(): Promise<express.RequestHandler> {
        return async (_req, response, next) => {
            return (async () => {
                response.setHeader('Content-Type', 'text/plain');
                response.send(await this.makeMetrics());

                next();
            })();

        };
    }
}