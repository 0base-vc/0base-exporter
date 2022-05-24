import * as express from 'express';
import {Express} from 'express';
import * as http from "http";
import * as morgan from 'morgan';
import TargetAbstract from "./target.abstract";

export default class Server {
    private readonly app: Express = express();
    private server: http.Server = undefined;

    public async setup(): Promise<void> {
        this.app.use(morgan('combined'));
        this.app.use('/metrics', await this.getMetricLoader());
    }

    private getMetricLoader(): Promise<express.RequestHandler> {
        console.log('BLOCKCHAIN', process.env.BLOCKCHAIN || './availables/tendermint.ts');
        const Cls = require(process.env.BLOCKCHAIN || './availables/tendermint.ts').default;
        const cls: TargetAbstract = new Cls(
            process.env.EXISTING_METRICS_URL,
            process.env.API_URL,
            process.env.ADDRESS,
            process.env.VALIDATOR);

        return cls.metrics();
    }

    public async start(): Promise<{ server: http.Server, port: string }> {
        return this.setup().then(() => {
            const port = process.env.PORT || '27770';
            this.server = this.app.listen(port);
            return {server: this.server, port: port};
        });
    }

}