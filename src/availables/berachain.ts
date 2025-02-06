import {Web3} from "web3";
import {Gauge} from "prom-client";
import Tendermint from "./tendermint-v1";

export default class Berachain extends Tendermint {
    public readonly web3: Web3;

    protected readonly BGTContractAddress = '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba';
    protected readonly HoneyContractAddress = '0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce';


    protected readonly boostedGauge = new Gauge({
        name: `${this.metricPrefix}_validator_boosted`,
        help: 'Boosted balance of validator',
        labelNames: ['validator', 'denom']
    });


    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly addresses: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, addresses, validator);

        this.web3 = new Web3(process.env.EVM_API_URL);
        this.registry.registerMetric(this.boostedGauge);
    }

    public async makeMetrics(): Promise<string> {
        // await super.makeMetrics();

        let customMetrics = '';
        try {
            await Promise.all([
                await this.updateEvmAddressBalance(this.addresses),
            ]);
            customMetrics = await this.registry.metrics();
        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    protected async updateEvmAddressBalance(addresses: string): Promise<void> {

        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        for (const address of evmAddresses) {

            const available = await this.getEVMAmount(address);
            this.availableGauge.labels(address, 'BERA').set(available.amount);

            const bgt = await this.getBGTAmount(address);
            this.availableGauge.labels(address, 'BGT').set(bgt.amount);

            const honey = await this.getERC20Amount(this.HoneyContractAddress, address, this.decimalPlaces);
            this.availableGauge.labels(address, 'Honey').set(honey.amount);

            const boostees = await this.getBoostees(address);
            this.boostedGauge.labels(address, 'BGT').set(boostees.amount);
        }
    }


    //curl -X POST -H "Content-Type: application/json" https://berachain-v2-testnet-node-web3.1xp.vc -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x7A9Ba30e544d2b6F1cD11709e9F0a5C57A779e94", "latest"],"id":1}'
    //curl -X POST -H "Content-Type: application/json" http://localhost:8545 -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x7A9Ba30e544d2b6F1cD11709e9F0a5C57A779e94", "latest"],"id":1}'
    protected async getEVMAmount(address: string): Promise<{
        amount: number
    }> {
        try {
            const amount = await this.web3.eth.getBalance(address);
            return {
                amount: parseInt(amount.toString()) / Math.pow(10, this.decimalPlaces)
            };
        } catch (e) {
            console.error(e);
            return {
                amount: 0
            };
        }
    }


    protected async getERC20Amount(contract: string, address: string, decimalPlaces: number): Promise<{
        amount: number
    }> {
        const abi = require(`../abi/erc20.json`);
        const ERC20Contract = new this.web3.eth.Contract(abi, contract);
        try {
            const amount: bigint = await ERC20Contract.methods.balanceOf(address).call();
            console.log(address, amount);
            return {
                amount: parseInt(amount.toString()) / Math.pow(10, decimalPlaces)
            };
        } catch (e) {
            console.error(e);
            return {
                amount: 0
            };
        }
    }

    protected async getBGTAmount(address: string): Promise<{
        amount: number
    }> {
        const contract = this.BGTContractAddress;
        const abi = require(`../abi/berachain/${contract}.json`);
        const BGTContract = new this.web3.eth.Contract(abi, contract);
        try {
            const amount: bigint = await BGTContract.methods.balanceOf(address).call();
            return {
                amount: parseInt(amount.toString()) / Math.pow(10, this.decimalPlaces)
            };
        } catch (e) {
            console.error(e);
            return {
                amount: 0
            };
        }
    }

    protected async getBoostees(address: string): Promise<{
        amount: number
    }> {
        const contract = this.BGTContractAddress;
        const abi = require(`../abi/berachain/${contract}.json`);
        const BGTContract = new this.web3.eth.Contract(abi, contract);
        try {
            const amount: bigint = await BGTContract.methods.boostees(address).call();
            return {
                amount: parseInt(amount.toString()) / Math.pow(10, this.decimalPlaces)
            };
        } catch (e) {
            console.error(e);
            return {
                amount: 0
            };
        }
    }
}