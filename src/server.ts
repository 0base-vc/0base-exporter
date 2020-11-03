import * as express from 'express';
import {Express} from "express";
import * as http from "http";
import * as morgan from 'morgan';
import Loader from './loader';

export default class Server {
    private app: Express = express();
    private server: http.Server = undefined;

    public async setup(): Promise<void> {
        this.app.use(morgan('combined'));
        this.app.use('/metrics', await (new Loader()).loadApp());
    }

    public async start(): Promise<http.Server> {
        return this.setup().then(() => {
            this.server = this.app.listen(27770);
            return this.server;
        });
    }

}