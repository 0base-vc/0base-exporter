import * as express from 'express';
import {Express} from 'express';
import * as http from "http";
import * as morgan from 'morgan';
import TargetAbstract from "./target.abstract";

export default class Server {
    private readonly app: Express = express();
    private server: http.Server = undefined;
    private targetInstance: TargetAbstract = null; // 싱글톤 인스턴스
    
    public async setup(): Promise<void> {
        this.app.use(morgan('combined'));
        this.app.use('/metrics', await this.getMetricLoader());
    }
    
    private async getMetricLoader(): Promise<express.RequestHandler> {
        // 인스턴스가 없을 때만 생성 (싱글톤 패턴)
        if (!this.targetInstance) {
            console.log('BLOCKCHAIN', process.env.BLOCKCHAIN || './availables/tendermint.ts');
            const Cls = require(process.env.BLOCKCHAIN || './availables/tendermint.ts').default;
            this.targetInstance = new Cls(
                process.env.EXISTING_METRICS_URL,
                process.env.API_URL,
                process.env.RPC_URL,
                process.env.ADDRESS,
                process.env.VALIDATOR
            );
        }
        
        // 메트릭 핸들러 반환
        return async (_req: express.Request, res: express.Response) => {
            try {
                const metrics = await this.targetInstance.makeMetrics();
                res.set('Content-Type', 'text/plain');
                res.send(metrics);
            } catch (error) {
                console.error('Error generating metrics:', error);
                res.status(500).send('Error generating metrics');
            }
        };
    }
    
    public async start(): Promise<{ server: http.Server, port: string }> {
        return this.setup().then(() => {
            const port = process.env.PORT || '27770';
            this.server = this.app.listen(port, () => {
                console.log(`Server started on port ${port}`);
            });
            
            return { server: this.server, port: port };
        });
    }
}