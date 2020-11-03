import * as express from 'express';
import Target from './enables/target';

export default class Loader {
    constructor() {
    }

    public loadApp(): Promise<express.RequestHandler> {
        return new Target().metrics();
    }
}