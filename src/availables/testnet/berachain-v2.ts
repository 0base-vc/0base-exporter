import TendermintBerachain from "../tendermint-berachain";
import {Web3} from "web3";
import {Gauge} from "prom-client";
import axios from "axios";

export default class BerachainV2 extends TendermintBerachain {
    public readonly web3: Web3;
    protected readonly boostedGauge = new Gauge({
        name: `${this.metricPrefix}_validator_boosted`,
        help: 'Boosted balance of validator',
        labelNames: ['validator', 'denom']
    });

    protected readonly swapPriceGauge = new Gauge({
        name: `${this.metricPrefix}_swap_price`,
        help: 'Swap price',
        labelNames: ['from', 'to']
    });

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly addresses: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, addresses, validator);

        this.web3 = new Web3(process.env.EVM_API_URL);
        this.registry.registerMetric(this.boostedGauge);
        this.registry.registerMetric(this.swapPriceGauge);
    }

    public async makeMetrics(): Promise<string> {
        await super.makeMetrics();

        let customMetrics = '';
        try {
            await Promise.all([
                await this.updateEvmAddressBalance(this.addresses),
                await this.getBeraToHoneyPrice(),
            ]);
            customMetrics = await this.registry.metrics();
        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    protected async updateEvmAddressBalance(addresses: string): Promise<void> {
        /*
        curl http://testnet.1xp.vc:30501/ \
            -X POST \
            -H "Content-Type: application/json" \
            --data '{"method":"eth_getBalance","params":["0x7A9BA30E544D2B6F1CD11709E9F0A5C57A779E94", "latest"],"id":1,"jsonrpc":"2.0"}'
        */
        // {"jsonrpc":"2.0","id":1,"result":"0x20877c4cbd1f97ad78"}

        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        for (const address of evmAddresses) {

            const available = await this.getEVMAmount(address);
            this.availableGauge.labels(address, 'BERA').set(available.amount);

            const bgt = await this.getBGTAmount(address);
            this.availableGauge.labels(address, 'BGT').set(bgt.amount);

            const honey = await this.getERC20Amount('0x0E4aaF1351de4c0264C5c7056Ef3777b41BD8e03', address);
            this.availableGauge.labels(address, 'Honey').set(honey.amount);

            const wbera = await this.getERC20Amount('0x7507c1dc16935B82698e4C63f2746A2fCf994dF8', address);
            this.availableGauge.labels(address, 'WBERA').set(wbera.amount);

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


    protected async getERC20Amount(contract: string, address: string): Promise<{
        amount: number
    }> {
        const abi = require(`../../abi/erc20.json`);
        const ERC20Contract = new this.web3.eth.Contract(abi, contract);
        try {
            const amount: bigint = await ERC20Contract.methods.balanceOf(address).call();
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

    protected async getBGTAmount(address: string): Promise<{
        amount: number
    }> {
        const contract = '0xbDa130737BDd9618301681329bF2e46A016ff9Ad'
        const abi = require(`../../abi/berachain-v2/${contract}.json`);
        const BGTContract = new this.web3.eth.Contract(abi, contract);
        try {
            const amount: bigint = await BGTContract.methods.unboostedBalanceOf(address).call();
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
        const contract = '0xbDa130737BDd9618301681329bF2e46A016ff9Ad'
        const abi = require(`../../abi/berachain-v2/${contract}.json`);
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

    public async getBeraToHoneyPrice(): Promise<void> {
        return await axios.post('https://api.goldsky.com/api/public/project_clq1h5ct0g4a201x18tfte5iv/subgraphs/bex-subgraph/v1/gn', {
            "operationName": "GetTokenHoneyPrice",
            "variables": {
                "id": "0x7507c1dc16935b82698e4c63f2746a2fcf994df8"
            },
            "query": "query GetTokenHoneyPrice($id: String) {\n  tokenHoneyPrice(id: $id) {\n    id\n    price\n    __typename\n  }\n}"
        }, {
            headers: {
                "content-type": "application/json",
                "Referer": "https://bartio.bex.berachain.com/",
            }
        }).then(response => {
            this.swapPriceGauge.labels('bera', 'honey').set(Number(response.data.data.tokenHoneyPrice.price));
        });
    }


}