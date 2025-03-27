import {Web3} from "web3";
import {Gauge} from "prom-client";
import Tendermint from "./tendermint-v1";
import axios from "axios";

interface ERC20TokenMetadata {
    name: string;
    symbol: string;
    decimals: number;
}

export default class Berachain extends Tendermint {
    public readonly web3: Web3;

    protected readonly BGTContractAddress = '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba';
    protected readonly BGTStakerContractAddress = '0x44F07Ce5AfeCbCC406e6beFD40cc2998eEb8c7C6';
    private readonly BGTContract;
    private readonly BGTStakerContract;
    private readonly alchemyApiUrl = 'https://berachain-mainnet.g.alchemy.com/v2/';
    private readonly alchemyApiKey = process.env.ALCHEMY_API_KEY || '';
    private erc20Metadata: Map<string, ERC20TokenMetadata> = new Map();

    protected readonly boostedGauge = new Gauge({
        name: `${this.metricPrefix}_validator_boosted`,
        help: 'Boosted balance of validator',
        labelNames: ['validator', 'denom']
    });

    protected readonly earnedHoneyGauge = new Gauge({
        name: `${this.metricPrefix}_earned_honey`,
        help: 'Earned Honey of validator',
        labelNames: ['address', 'denom']
    });

    protected readonly erc20BalanceGauge = new Gauge({
        name: `${this.metricPrefix}_erc20_balance`,
        help: 'ERC20 token balance',
        labelNames: ['address', 'contractAddress', 'token', 'symbol']
    });

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly rpcUrl: string,
                       protected readonly addresses: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, rpcUrl, addresses, validator);

        this.web3 = new Web3(process.env.EVM_API_URL);
        this.BGTContract = new this.web3.eth.Contract(require(`../abi/berachain/${this.BGTContractAddress}.json`), this.BGTContractAddress);
        this.BGTStakerContract = new this.web3.eth.Contract(require(`../abi/berachain/${this.BGTStakerContractAddress}.json`), this.BGTStakerContractAddress);

        this.registry.registerMetric(this.boostedGauge);
        this.registry.registerMetric(this.earnedHoneyGauge);
        this.registry.registerMetric(this.erc20BalanceGauge);

        // 초기 ERC20 토큰 스캔 실행
        this.scanERC20Tokens();
        
        // 1시간마다 ERC20 토큰 메타데이터 스캔
        setInterval(() => {
            this.scanERC20Tokens();
        }, 60 * 60 * 1000); // 1시간 = 60분 * 60초 * 1000밀리초
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

    // ERC20 토큰 스캔 메서드
    private async scanERC20Tokens(): Promise<void> {
        const evmAddresses = this.addresses.split(',').filter((address) => address.startsWith('0x') && address.length < 50);
        
        try {
            for (const address of evmAddresses) {
                const response = await axios.post(`${this.alchemyApiUrl}${this.alchemyApiKey}`, {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'alchemy_getTokenBalances',
                    params: [address, 'erc20']
                });
                
                if (response.data && response.data.result && response.data.result.tokenBalances) {
                    for (const token of response.data.result.tokenBalances) {
                        const contractAddress = token.contractAddress;
                        
                        // 토큰 메타데이터가 아직 저장되지 않은 경우에만 조회
                        if (!this.erc20Metadata.has(contractAddress)) {
                            try {
                                const metadataResponse = await axios.post(`${this.alchemyApiUrl}${this.alchemyApiKey}`, {
                                    jsonrpc: '2.0',
                                    id: 1,
                                    method: 'alchemy_getTokenMetadata',
                                    params: [contractAddress]
                                });
                                
                                if (metadataResponse.data && metadataResponse.data.result) {
                                    const metadata = metadataResponse.data.result;
                                    this.erc20Metadata.set(contractAddress, {
                                        name: metadata.name || 'Unknown',
                                        symbol: metadata.symbol || 'UNKNOWN',
                                        decimals: metadata.decimals || 18
                                    });
                                }
                            } catch (e) {
                                console.error(`Error fetching metadata for token ${contractAddress}:`, e);
                            }
                        }
                    }
                }
            }
            
            console.log(`Scanned ERC20 tokens, found ${this.erc20Metadata.size} unique tokens`);
        } catch (e) {
            console.error('Error scanning ERC20 tokens:', e);
        }
    }

    protected async updateEvmAddressBalance(addresses: string): Promise<void> {
        this.boostedGauge.reset();
        this.earnedHoneyGauge.reset();
        this.erc20BalanceGauge.reset();

        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        for (const address of evmAddresses) {
            if (address.length > 50) {
                //pubkey
                const boostees = await this.getBoostees(address);
                this.boostedGauge.labels(address, 'BGT').set(boostees.amount);
            } else {
                // BERA 네이티브 토큰 조회
                const bera = await this.getEVMAmount(address);
                this.availableGauge.labels(address, 'BERA').set(bera.amount);

                // BGT 밸런스 조회 (ERC20 아님)
                const bgt = await this.getBGTAmount(address);
                this.availableGauge.labels(address, 'BGT').set(bgt.amount);

                // ERC20 토큰 밸런스 조회
                for (const [tokenAddress, metadata] of this.erc20Metadata.entries()) {
                    try {
                        const tokenContract = new this.web3.eth.Contract(require('../abi/erc20.json'), tokenAddress);
                        const balance: bigint = await tokenContract.methods.balanceOf(address).call();
                        const amount = parseInt(balance.toString()) / Math.pow(10, metadata.decimals);
                        
                        this.erc20BalanceGauge.labels(address, tokenAddress, metadata.name, metadata.symbol).set(amount);
                    } catch (e) {
                        console.error(`Error fetching balance for token ${tokenAddress} (${metadata.symbol})`, e);
                    }
                }

                // 스테이킹으로 얻은 Honey 조회
                const earnedHoney = await this.getBGTStakerEarnedAmount(address, this.decimalPlaces);
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

    protected async getBGTStakerEarnedAmount(address: string, decimalPlaces: number): Promise<{
        amount: number
    }> {
        try {
            const amount: bigint = await this.BGTStakerContract.methods.earned(address).call();
            return {
                amount: parseInt(amount.toString()) / Math.pow(10, decimalPlaces)
            };
        } catch (e) {
            console.error('getBGTStakerEarnedAmount');
            console.error(e);
            return {
                amount: 0
            };
        }
    }

    protected async getBGTAmount(address: string): Promise<{
        amount: number
    }> {
        try {
            const amount: bigint = await this.BGTContract.methods.balanceOf(address).call();
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
        try {
            const amount: bigint = await this.BGTContract.methods.boostees(address).call();
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