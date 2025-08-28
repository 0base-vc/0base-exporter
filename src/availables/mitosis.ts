import {Web3} from "web3";
import {Gauge} from "prom-client";
import Tendermint from "./tendermint-v1";
import * as _ from 'lodash';

export default class Mitosis extends Tendermint {
    public readonly web3: Web3;
    private readonly gMitoContractAddress: string = '0x1248163272144FdbBbE6D1a8c43Ca56DE9bD5cEA';
    private gMitoDecimals: number | null = null;
    private readonly validatorRewardDistributorContractAddress: string = '0x124816321ac3a7F3A68Cf2D36876e670beaBC6c7';

    protected readonly erc20BalanceGauge = new Gauge({
        name: `${this.metricPrefix}_erc20_balance`,
        help: 'ERC20 token balance',
        labelNames: ['address', 'contractAddress', 'token', 'symbol']
    });

    protected readonly validatorsCollateralGauge = new Gauge({
        name: `${this.metricPrefix}_validators_collateral`,
        help: 'Validators collateral amount',
        labelNames: ['address', 'moniker']
    });

    protected readonly validatorsExtraVotingPowerGauge = new Gauge({
        name: `${this.metricPrefix}_validators_extra_voting_power`,
        help: 'Validators extra voting power',
        labelNames: ['address', 'moniker']
    });

    protected readonly validatorsVotingPowerGauge = new Gauge({
        name: `${this.metricPrefix}_validators_voting_power`,
        help: 'Validators voting power',
        labelNames: ['address', 'moniker']
    });

    protected readonly validatorsCommissionRateGauge = new Gauge({
        name: `${this.metricPrefix}_validators_commission_rate`,
        help: 'Validators commission rate',
        labelNames: ['address', 'moniker']
    });

    protected readonly validatorsPendingCommissionRateGauge = new Gauge({
        name: `${this.metricPrefix}_validators_pending_commission_rate`,
        help: 'Validators pending commission rate',
        labelNames: ['address', 'moniker']
    });

    protected readonly validatorsPendingCommissionRateUpdateEpochGauge = new Gauge({
        name: `${this.metricPrefix}_validators_pending_commission_rate_update_epoch`,
        help: 'Validators pending commission rate update epoch',
        labelNames: ['address', 'moniker']
    });

    private readonly validatorManagerContractAddress: string = '0x12481632e81c446ecFa1CD8F93df4DebC8F5ACd2';

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly rpcUrl: string,
                       protected readonly addresses: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, rpcUrl, addresses, validator);

        this.web3 = new Web3(process.env.EVM_API_URL);
        this.registry.registerMetric(this.erc20BalanceGauge);
        this.registry.registerMetric(this.validatorsCollateralGauge);
        this.registry.registerMetric(this.validatorsExtraVotingPowerGauge);
        this.registry.registerMetric(this.validatorsVotingPowerGauge);
        this.registry.registerMetric(this.validatorsCommissionRateGauge);
        this.registry.registerMetric(this.validatorsPendingCommissionRateGauge);
        this.registry.registerMetric(this.validatorsPendingCommissionRateUpdateEpochGauge);
    }

    public async makeMetrics(): Promise<string> {
        // await super.makeMetrics();

        let customMetrics = '';
        try {
            await Promise.all([
                this.updateEvmAddressBalance(this.addresses),
                this.updateRank(this.validator),
                this.updateMaxValidator(),
                this.updateValidatorsPower(),
                this.updateOperatorCommission(this.validator),
            ]);
            customMetrics = await this.registry.metrics();
        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    protected async updateRank(validator: string): Promise<void> {
        const url = `${this.apiUrl}/mitosis/evmvalidator/v1/validators`;

        return this.get(url, (response: { data: any }) => {
            const sorted = _.sortBy(response.data.validators, (o: any) => {
                return parseInt(o.collateral_shares);
            }).reverse();

            const rank = _.findIndex(sorted, (o: any) => {
                return o.addr.toLowerCase() === validator.toLowerCase();
            }) + 1;

            const me = sorted[rank - 1];
            const above = sorted[rank - 2] || {collateral_shares: me.collateral_shares};
            const below = sorted[rank] || {collateral_shares: '0'};

            this.rankGauge.labels(validator).set(rank);
            this.rivalsPowerGauge.labels('above').set(parseInt(above.collateral_shares) / Math.pow(10, this.decimalPlaces));
            this.rivalsPowerGauge.labels('below').set(parseInt(below.collateral_shares) / Math.pow(10, this.decimalPlaces));
        });
    }


    protected async updateMaxValidator(): Promise<void> {
        const url = `${this.apiUrl}/mitosis/evmvalidator/v1/params`;

        return this.get(url, (response: { data: any }) => {
            const limit = response.data.params.max_validators;
            this.maxValidatorGauge.set(limit);
        });
    }


    protected async updateValidatorsPower(): Promise<void> {
        const url = `${this.apiUrl}/mitosis/evmvalidator/v1/validators`;

        return this.get(url, async (response: { data: any }) => {
            const validators = response.data.validators;
            for (const validator of validators) {
                // 스마트 컨트랙트에서 모든 정보 가져오기 (한 번의 호출로 최적화)
                await this.updateValidatorInfo(validator);
            }
        });
    }

    protected async updateEvmAddressBalance(addresses: string): Promise<void> {
        this.erc20BalanceGauge.reset();

        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        for (const address of evmAddresses) {

            // 네이티브 토큰 조회
            const mito = await this.getEVMAmount(address);
            this.availableGauge.labels(address, 'MITO').set(mito.amount);

            // gMITO(ERC20) 토큰 조회 (contract address는 환경변수로 주입)
            if (this.gMitoContractAddress) {
                try {
                    const tokenContract = new this.web3.eth.Contract(this.erc20Abi as any, this.gMitoContractAddress);
                    if (this.gMitoDecimals == null) {
                        const decimals: number = await tokenContract.methods.decimals().call();
                        this.gMitoDecimals = Number(decimals) || 18;
                    }
                    const balance: bigint = await tokenContract.methods.balanceOf(address).call();
                    const amount = parseInt(balance.toString()) / Math.pow(10, this.gMitoDecimals);
                    this.availableGauge.labels(address, 'gMITO').set(amount);
                } catch (e) {
                    console.error('gMITO balance fetch error', e);
                }
            }
        }
    }

    protected async updateOperatorCommission(validator: string): Promise<void> {
        if (!this.validatorRewardDistributorContractAddress) return;
        try {
            const abi = [
                {
                    inputs: [{ internalType: 'address', name: 'operator', type: 'address' }],
                    name: 'claimableOperatorRewards',
                    outputs: [
                        { internalType: 'uint256', name: '', type: 'uint256' },
                        { internalType: 'uint256', name: '', type: 'uint256' }
                    ],
                    stateMutability: 'view',
                    type: 'function'
                }
            ];
            const contract = new this.web3.eth.Contract(abi as any, this.validatorRewardDistributorContractAddress);
            const result: [string, string] = await contract.methods.claimableOperatorRewards(validator).call();
            const primary = parseInt(result[0].toString()) / Math.pow(10, this.decimalPlaces);
            this.commissionGauge.labels(validator, 'gMITO').set(primary);
        } catch (e) {
            console.error('updateOperatorCommission error', e);
        }
    }

    // 컨트랙트 인스턴스 재사용
    private validatorManagerContract?: any;
    
    // ERC20 ABI 정의 (필요한 함수들만)
    private readonly erc20Abi = [
        {
            "inputs": [],
            "name": "decimals",
            "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
            "name": "balanceOf", 
            "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
            "stateMutability": "view",
            "type": "function"
        }
    ];
    
    // Validator Manager ABI 정의
    private readonly validatorManagerAbi = [
        {
            "type": "function",
            "name": "validatorInfo",
            "inputs": [
                {
                    "name": "valAddr",
                    "type": "address",
                    "internalType": "address"
                }
            ],
            "outputs": [
                {
                    "name": "",
                    "type": "tuple",
                    "internalType": "struct IValidatorManager.ValidatorInfoResponse",
                    "components": [
                        {
                            "name": "valAddr",
                            "type": "address",
                            "internalType": "address"
                        },
                        {
                            "name": "pubKey",
                            "type": "bytes",
                            "internalType": "bytes"
                        },
                        {
                            "name": "operator",
                            "type": "address",
                            "internalType": "address"
                        },
                        {
                            "name": "rewardManager",
                            "type": "address",
                            "internalType": "address"
                        },
                        {
                            "name": "commissionRate",
                            "type": "uint256",
                            "internalType": "uint256"
                        },
                        {
                            "name": "pendingCommissionRate",
                            "type": "uint256",
                            "internalType": "uint256"
                        },
                        {
                            "name": "pendingCommissionRateUpdateEpoch",
                            "type": "uint256",
                            "internalType": "uint256"
                        },
                        {
                            "name": "metadata",
                            "type": "bytes",
                            "internalType": "bytes"
                        }
                    ]
                }
            ],
            "stateMutability": "view"
        }
    ];

    private getValidatorManagerContract() {
        if (!this.validatorManagerContract) {
            this.validatorManagerContract = new this.web3.eth.Contract(this.validatorManagerAbi as any, this.validatorManagerContractAddress);
        }
        return this.validatorManagerContract;
    }

    private async updateValidatorInfo(validator: any): Promise<void> {
        try {
            // 스마트 컨트랙트에서 정보 가져오기
            const contract = this.getValidatorManagerContract();
            const result = await contract.methods.validatorInfo(validator.addr).call();
            
            // Metadata에서 moniker 추출 (JSON 파싱)
            const metadata = this.parseMetadataToJson(result.metadata);
            const moniker = metadata?.name || 'Unknown';
            
            // API 데이터로 기본 validator power 정보 업데이트 (moniker 포함)
            this.validatorsGauge.labels(validator.addr).set(parseInt(validator.collateral_shares));
            this.validatorsCollateralGauge.labels(validator.addr, moniker).set(parseInt(validator.collateral));
            this.validatorsExtraVotingPowerGauge.labels(validator.addr, moniker).set(parseInt(validator.extra_voting_power));
            this.validatorsVotingPowerGauge.labels(validator.addr, moniker).set(parseInt(validator.voting_power));
            
            // 컨트랙트 데이터로 commission rate 정보 업데이트
            const commissionRatePercent = parseFloat((parseInt(result.commissionRate) / 100).toFixed(2));
            const pendingCommissionRatePercent = parseFloat((parseInt(result.pendingCommissionRate) / 100).toFixed(2));
            const pendingCommissionRateUpdateEpoch = parseInt(result.pendingCommissionRateUpdateEpoch);
            
            this.validatorsCommissionRateGauge.labels(validator.addr, moniker).set(commissionRatePercent);
            this.validatorsPendingCommissionRateGauge.labels(validator.addr, moniker).set(pendingCommissionRatePercent);
            this.validatorsPendingCommissionRateUpdateEpochGauge.labels(validator.addr, moniker).set(pendingCommissionRateUpdateEpoch);
            
        } catch (e) {
            console.error(`Error fetching validator info for ${validator.addr}:`, e);
            // 에러 발생 시 기본값으로 설정
            const fallbackMoniker = 'Unknown';
            this.validatorsGauge.labels(validator.addr).set(parseInt(validator.collateral_shares || '0'));
            this.validatorsCollateralGauge.labels(validator.addr, fallbackMoniker).set(parseInt(validator.collateral || '0'));
            this.validatorsExtraVotingPowerGauge.labels(validator.addr, fallbackMoniker).set(parseInt(validator.extra_voting_power || '0'));
            this.validatorsVotingPowerGauge.labels(validator.addr, fallbackMoniker).set(parseInt(validator.voting_power || '0'));
            this.validatorsCommissionRateGauge.labels(validator.addr, fallbackMoniker).set(0);
            this.validatorsPendingCommissionRateGauge.labels(validator.addr, fallbackMoniker).set(0);
            this.validatorsPendingCommissionRateUpdateEpochGauge.labels(validator.addr, fallbackMoniker).set(0);
        }
    }

    private parseMetadataToJson(metadataHex: string): any {
        try {
            if (!metadataHex || metadataHex === '0x') {
                return null;
            }
            
            // bytes를 string으로 변환
            const hex = metadataHex.slice(2); // 0x 제거
            const metadataString = Buffer.from(hex, 'hex').toString('utf8');
            
            // null byte 제거
            const cleanedString = metadataString.replace(/\0/g, '');
            
            if (!cleanedString.trim()) {
                return null;
            }
            
            // JSON 파싱 시도
            return JSON.parse(cleanedString);
        } catch (e) {
            console.error('Metadata JSON parsing error:', e);
            // JSON 파싱이 실패하면 plain text로 처리
            try {
                const hex = metadataHex.slice(2);
                const plainText = Buffer.from(hex, 'hex').toString('utf8').replace(/\0/g, '');
                return { name: plainText.trim() || 'Unknown' };
            } catch (fallbackError) {
                console.error('Metadata fallback parsing error:', fallbackError);
                return { name: 'Unknown' };
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
}