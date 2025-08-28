import {Web3} from "web3";
import {Gauge} from "prom-client";
import Tendermint from "./tendermint-v1";
import * as _ from 'lodash';
import erc20Abi from '../abi/erc20.json';

export default class Mitosis extends Tendermint {
    public readonly web3: Web3;
    private readonly gMitoContractAddress: string = '';
    private gMitoDecimals: number | null = null;
    private readonly validatorRewardDistributorContractAddress: string = '';

    protected readonly erc20BalanceGauge = new Gauge({
        name: `${this.metricPrefix}_erc20_balance`,
        help: 'ERC20 token balance',
        labelNames: ['address', 'contractAddress', 'token', 'symbol']
    });

    protected readonly validatorsCollateralGauge = new Gauge({
        name: `${this.metricPrefix}_validators_collateral`,
        help: 'Validators collateral amount',
        labelNames: ['address']
    });

    protected readonly validatorsExtraVotingPowerGauge = new Gauge({
        name: `${this.metricPrefix}_validators_extra_voting_power`,
        help: 'Validators extra voting power',
        labelNames: ['address']
    });

    protected readonly validatorsVotingPowerGauge = new Gauge({
        name: `${this.metricPrefix}_validators_voting_power`,
        help: 'Validators voting power',
        labelNames: ['address']
    });

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

        return this.get(url, (response: { data: any }) => {
            const validators = response.data.validators;
            validators.forEach((validator: any) => {
                this.validatorsGauge.labels(validator.addr).set(parseInt(validator.collateral_shares));
                this.validatorsCollateralGauge.labels(validator.addr).set(parseInt(validator.collateral));
                this.validatorsExtraVotingPowerGauge.labels(validator.addr).set(parseInt(validator.extra_voting_power));
                this.validatorsVotingPowerGauge.labels(validator.addr).set(parseInt(validator.voting_power));
            });
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
                    const tokenContract = new this.web3.eth.Contract(erc20Abi as any, this.gMitoContractAddress);
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