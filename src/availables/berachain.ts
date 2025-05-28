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

    // 날짜별 인센티브(USD) 기록용 Gauge
    protected readonly incentiveByDateGauge = new Gauge({
        name: `${this.metricPrefix}_incentive_rewards_by_date`,
        help: '날짜별 인센티브 총합(USD)',
        labelNames: ['date', 'currency']
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
        this.registry.registerMetric(this.incentiveByDateGauge);

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
                this.updateBoosted(),
                this.fetchDailyIncentives()
            ]);

            customMetrics = await this.registry.metrics();
        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    // ERC20 토큰 스캔 메서드
    private async scanERC20Tokens(): Promise<void> {
        const evmAddresses = this.addresses.split(',');
        
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
                            await this.fetchTokenMetadata(contractAddress);
                        }
                    }
                }
            }
            
            console.log(`Scanned ERC20 tokens, found ${this.erc20Metadata.size} unique tokens`);
        } catch (e) {
            console.error('Error scanning ERC20 tokens:', e);
        }
    }

    // 토큰 메타데이터 조회 함수
    private async fetchTokenMetadata(contractAddress: string): Promise<void> {
        if (this.erc20Metadata.has(contractAddress)) {
            return; // 이미 메타데이터가 있으면 스킵
        }

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
            // 에러 발생 시 기본 메타데이터 설정
            this.erc20Metadata.set(contractAddress, {
                name: 'Unknown',
                symbol: 'UNKNOWN',
                decimals: 18
            });
        }
    }


    protected async updateBoosted(): Promise<void> {
        this.boostedGauge.reset();
        const boostees = await this.getBoostees(this.validator);
        this.boostedGauge.labels(this.validator, 'BGT').set(boostees.amount);
    }

    protected async updateEvmAddressBalance(addresses: string): Promise<void> {
        this.earnedHoneyGauge.reset();
        this.erc20BalanceGauge.reset();

        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        for (const address of evmAddresses) {
            
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

    /**
     * 날짜별 인센티브(USD) 집계 및 Gauge 기록
     * Goldsky GraphQL API에서 incentiveDistributionByValidators를 가져오고, 토큰 가격을 Berachain API에서 받아와 USD로 환산하여 날짜별로 합산 후 Gauge에 기록
     */
    private async fetchDailyIncentives(): Promise<void> {
        // validator publicKey, timestamp 설정
        const pubKey = this.validator;
        // 30일 전부터 조회 (timestamp: 마이크로초 단위)
        const daysAgo = 30;
        const now = Math.floor(Date.now() / 1000);
        const fromTimestamp = (now - daysAgo * 24 * 60 * 60) * 1_000_000;
        // Goldsky GraphQL 쿼리
        const goldskyUrl = 'https://api.goldsky.com/api/public/project_clq1h5ct0g4a201x18tfte5iv/subgraphs/pol-subgraph/mainnet-v1.5.2/gn';
        const query = {
            operationName: 'GetValidatorAnalytics',
            variables: {
                pubKey: pubKey,
                timestamp: fromTimestamp.toString()
            },
            query: `query GetValidatorAnalytics($pubKey: Bytes!, $timestamp: Timestamp!) {\n  incentiveDistributionByValidators(\n    interval: day\n    where: {validator_: {publicKey: $pubKey}, timestamp_gte: $timestamp}\n  ) {\n    token {\n      address\n      symbol\n      decimals\n      name\n    }\n    receivedTokenAmount\n    timestamp\n    id\n    __typename\n  }\n}`
        };
        let incentiveList: any[] = [];
        try {
            const res = await axios.post(goldskyUrl, query, {
                headers: { 'content-type': 'application/json' }
            });
            incentiveList = res.data?.data?.incentiveDistributionByValidators || [];
        } catch (e) {
            console.error('Goldsky incentiveDistributionByValidators error', e);
            return;
        }
        // 날짜별, 토큰별 집계
        const dailyTokenMap: Record<string, Record<string, { amount: number, decimals: number }>> = {};
        for (const item of incentiveList) {
            const date = new Date(Number(item.timestamp) / 1000).toISOString().slice(0, 10); // YYYY-MM-DD
            const tokenAddr = item.token.address.toLowerCase();
            const decimals = item.token.decimals || 18;
            const amount = Number(item.receivedTokenAmount);
            if (!dailyTokenMap[date]) dailyTokenMap[date] = {};
            if (!dailyTokenMap[date][tokenAddr]) dailyTokenMap[date][tokenAddr] = { amount: 0, decimals };
            dailyTokenMap[date][tokenAddr].amount += amount;
        }
        // 토큰 가격 조회 (Berachain API)
        const tokenAddresses = Array.from(new Set(
            Object.values(dailyTokenMap).flatMap(tokens => Object.keys(tokens))
        ));
        let priceMap: Record<string, number> = {};
        if (tokenAddresses.length > 0) {
            const beraApiUrl = 'https://api.berachain.com/';
            const priceQuery = {
                operationName: 'GetTokenCurrentPrices',
                variables: {
                    chains: ['BERACHAIN'],
                    addressIn: tokenAddresses
                },
                query: `query GetTokenCurrentPrices($chains: [GqlChain!]!, $addressIn: [String!]!) {\n  tokenGetCurrentPrices(chains: $chains, addressIn: $addressIn) {\n    address\n    price\n  }\n}`
            };
            try {
                const priceRes = await axios.post(beraApiUrl, priceQuery, {
                    headers: { 'content-type': 'application/json' }
                });
                const priceList = priceRes.data?.data?.tokenGetCurrentPrices || [];
                for (const p of priceList) {
                    priceMap[p.address.toLowerCase()] = Number(p.price);
                }
            } catch (e) {
                console.error('Berachain price fetch error', e);
            }
        }
        // 날짜별 USD 집계 및 Gauge 기록
        for (const date of Object.keys(dailyTokenMap)) {
            let usdSum = 0;
            for (const tokenAddr of Object.keys(dailyTokenMap[date])) {
                const { amount } = dailyTokenMap[date][tokenAddr];
                const price = priceMap[tokenAddr] || 0;
                usdSum += amount * price;
            }
            // Prometheus Gauge 기록 (date, USD)
            this.incentiveByDateGauge.labels(date, 'USD').set(usdSum);
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