import {Web3} from "web3";
import {Gauge} from "prom-client";
import Tendermint from "./tendermint-v1";

export default class Berachain extends Tendermint {
    public readonly web3: Web3;

    protected readonly BGTContractAddress = '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba';
    protected readonly HoneyContractAddress = '0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce';
    protected readonly BGTStakerContractAddress = '0x44f07ce5afecbcc406e6befd40cc2998eeb8c7c6';

    protected readonly boostedGauge = new Gauge({
        name: `${this.metricPrefix}_validator_boosted`,
        help: 'Boosted balance of validator',
        labelNames: ['validator', 'denom']
    });

    protected readonly earnedHoneyGauge = new Gauge({
        name: `${this.metricPrefix}_earned_honey`,
        help: 'Earned Honey of validator',
        labelNames: ['validator', 'denom']
    });

    private readonly erc20Abi: any;
    private readonly bgtAbi: any;
    private readonly bgtStakerAbi: any;

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly rpcUrl: string,
                       protected readonly addresses: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, rpcUrl, addresses, validator);

        this.web3 = new Web3(process.env.EVM_API_URL);
        this.registry.registerMetric(this.boostedGauge);
        this.registry.registerMetric(this.earnedHoneyGauge);

        // 객체 생성 시 ABI 파일을 한 번만 불러오기
        this.erc20Abi = require('../abi/erc20.json');
        this.bgtAbi = require(`../abi/berachain/${this.BGTContractAddress}.json`);
        this.bgtStakerAbi = require(`../abi/berachain/${this.BGTStakerContractAddress}.json`);
    }

    public async makeMetrics(): Promise<string> {
        // await super.makeMetrics();

        let customMetrics = '';
        try {
            await Promise.all([
                this.updateValidatorsPower(),
                this.updateEvmAddressBalance(this.addresses),
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

            if(address.length > 50) {
                //pubkey
                const boostees = await this.getBoostees(address);
                this.boostedGauge.labels(address, 'BGT').set(boostees.amount);
            } else {
                const bera = await this.getEVMAmount(address);
                this.availableGauge.labels(address, 'BERA').set(bera.amount);

                const bgt = await this.getBGTAmount(address);
                this.availableGauge.labels(address, 'BGT').set(bgt.amount);

                const honey = await this.getERC20Amount(this.HoneyContractAddress, address, this.decimalPlaces);
                this.availableGauge.labels(address, 'Honey').set(honey.amount);

                const earnedHoney = await this.getBGTStakerEarnedAmount(this.BGTStakerContractAddress, address, this.decimalPlaces);
                this.earnedHoneyGauge.labels(address, 'Honey').set(earnedHoney.amount);
            }
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
        const ERC20Contract = new this.web3.eth.Contract(this.erc20Abi, contract);
        try {
            const amount: bigint = await ERC20Contract.methods.balanceOf(address).call();
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

    protected async getBGTStakerEarnedAmount(contract: string, address: string, decimalPlaces: number): Promise<{
        amount: number
    }> {
        const BGTStakerContract = new this.web3.eth.Contract(this.bgtStakerAbi, contract);
        try {
            const amount: bigint = await BGTStakerContract.methods.earned(address).call();
            return {
                amount: parseInt(amount.toString()) / Math.pow(10, decimalPlaces)
            };
        } catch (e) {
            console.error('getBGTStakerEarnedAmount');
            console.error(e);
            return {
                amount: 0
            }
        }
    }

    protected async getBGTAmount(address: string): Promise<{
        amount: number
    }> {
        const contract = this.BGTContractAddress;
        const BGTContract = new this.web3.eth.Contract(this.bgtAbi, contract);
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
        const BGTContract = new this.web3.eth.Contract(this.bgtAbi, contract);
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