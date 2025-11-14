import {Web3} from "web3";
import Tendermint from "./tendermint-v1";

export default class Monad extends Tendermint {
    public readonly web3: Web3;

    // Monad validator/reward manager contract (read-only)
    private readonly validatorContractAddress: string = '0x0000000000000000000000000000000000001000';
    // Prefer ENV-provided validatorId if available (only for Monad)
    private readonly validatorIdEnv: string | undefined = (process.env.MONAD_VALIDATOR_ID || process.env.VALIDATOR_ID || '')?.toString() || undefined;
    private readonly validatorAbi: any = [
        {"type":"function","name":"addValidator","inputs":[{"name":"payload","type":"bytes","internalType":"bytes"},{"name":"signedSecpMessage","type":"bytes","internalType":"bytes"},{"name":"signedBlsMessage","type":"bytes","internalType":"bytes"}],"outputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"}],"stateMutability":"payable"},
        {"type":"function","name":"changeCommission","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"},{"name":"commission","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"success","type":"bool","internalType":"bool"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"claimRewards","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"success","type":"bool","internalType":"bool"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"compound","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"success","type":"bool","internalType":"bool"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"delegate","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"success","type":"bool","internalType":"bool"}],"stateMutability":"payable"},
        {"type":"function","name":"externalReward","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"success","type":"bool","internalType":"bool"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getConsensusValidatorSet","inputs":[{"name":"startIndex","type":"uint32","internalType":"uint32"}],"outputs":[{"name":"isDone","type":"bool","internalType":"bool"},{"name":"nextIndex","type":"uint32","internalType":"uint32"},{"name":"valIds","type":"uint64[]","internalType":"uint64[]"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getDelegations","inputs":[{"name":"delegator","type":"address","internalType":"address"},{"name":"startValId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"isDone","type":"bool","internalType":"bool"},{"name":"nextValId","type":"uint64","internalType":"uint64"},{"name":"valIds","type":"uint64[]","internalType":"uint64[]"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getDelegator","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"},{"name":"delegator","type":"address","internalType":"address"}],"outputs":[{"name":"stake","type":"uint256","internalType":"uint256"},{"name":"accRewardPerToken","type":"uint256","internalType":"uint256"},{"name":"unclaimedRewards","type":"uint256","internalType":"uint256"},{"name":"deltaStake","type":"uint256","internalType":"uint256"},{"name":"nextDeltaStake","type":"uint256","internalType":"uint256"},{"name":"deltaEpoch","type":"uint64","internalType":"uint64"},{"name":"nextDeltaEpoch","type":"uint64","internalType":"uint64"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getDelegators","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"},{"name":"startDelegator","type":"address","internalType":"address"}],"outputs":[{"name":"isDone","type":"bool","internalType":"bool"},{"name":"nextDelegator","type":"address","internalType":"address"},{"name":"delegators","type":"address[]","internalType":"address[]"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getEpoch","inputs":[],"outputs":[{"name":"epoch","type":"uint64","internalType":"uint64"},{"name":"inEpochDelayPeriod","type":"bool","internalType":"bool"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getProposerValId","inputs":[],"outputs":[{"name":"val_id","type":"uint64","internalType":"uint64"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getExecutionValidatorSet","inputs":[{"name":"startIndex","type":"uint32","internalType":"uint32"}],"outputs":[{"name":"isDone","type":"bool","internalType":"bool"},{"name":"nextIndex","type":"uint32","internalType":"uint32"},{"name":"valIds","type":"uint64[]","internalType":"uint64[]"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getSnapshotValidatorSet","inputs":[{"name":"startIndex","type":"uint32","internalType":"uint32"}],"outputs":[{"name":"isDone","type":"bool","internalType":"bool"},{"name":"nextIndex","type":"uint32","internalType":"uint32"},{"name":"valIds","type":"uint64[]","internalType":"uint64[]"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"getValidator","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"authAddress","type":"address","internalType":"address"},{"name":"flags","type":"uint64","internalType":"uint64"},{"name":"stake","type":"uint256","internalType":"uint256"},{"name":"accRewardPerToken","type":"uint256","internalType":"uint256"},{"name":"commission","type":"uint256","internalType":"uint256"},{"name":"unclaimedRewards","type":"uint256","internalType":"uint256"},{"name":"consensusStake","type":"uint256","internalType":"uint256"},{"name":"consensusCommission","type":"uint256","internalType":"uint256"},{"name":"snapshotStake","type":"uint256","internalType":"uint256"},{"name":"snapshotCommission","type":"uint256","internalType":"uint256"},{"name":"secpPubkey","type":"bytes","internalType":"bytes"},{"name":"blsPubkey","type":"bytes","internalType":"bytes"}],"stateMutability":"view"},
        {"type":"function","name":"getWithdrawalRequest","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"},{"name":"delegator","type":"address","internalType":"address"},{"name":"withdrawId","type":"uint8","internalType":"uint8"}],"outputs":[{"name":"withdrawalAmount","type":"uint256","internalType":"uint256"},{"name":"accRewardPerToken","type":"uint256","internalType":"uint256"},{"name":"withdrawEpoch","type":"uint64","internalType":"uint64"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"syscallOnEpochChange","inputs":[{"name":"epoch","type":"uint64","internalType":"uint64"}],"outputs":[],"stateMutability":"nonpayable"},
        {"type":"function","name":"syscallReward","inputs":[{"name":"blockAuthor","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},
        {"type":"function","name":"syscallSnapshot","inputs":[],"outputs":[],"stateMutability":"nonpayable"},
        {"type":"function","name":"undelegate","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"withdrawId","type":"uint8","internalType":"uint8"}],"outputs":[{"name":"success","type":"bool","internalType":"bool"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"withdraw","inputs":[{"name":"validatorId","type":"uint64","internalType":"uint64"},{"name":"withdrawId","type":"uint8","internalType":"uint8"}],"outputs":[{"name":"success","type":"bool","internalType":"bool"}],"stateMutability":"nonpayable"},
        {"type":"event","name":"ClaimRewards","inputs":[{"name":"validatorId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"delegator","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"epoch","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false},
        {"type":"event","name":"CommissionChanged","inputs":[{"name":"validatorId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"oldCommission","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"newCommission","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
        {"type":"event","name":"Delegate","inputs":[{"name":"validatorId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"delegator","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"activationEpoch","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false},
        {"type":"event","name":"EpochChanged","inputs":[{"name":"oldEpoch","type":"uint64","indexed":false,"internalType":"uint64"},{"name":"newEpoch","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false},
        {"type":"event","name":"Undelegate","inputs":[{"name":"validatorId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"delegator","type":"address","indexed":true,"internalType":"address"},{"name":"withdrawId","type":"uint8","indexed":false,"internalType":"uint8"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"activationEpoch","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false},
        {"type":"event","name":"ValidatorCreated","inputs":[{"name":"validatorId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"authAddress","type":"address","indexed":true,"internalType":"address"},{"name":"commission","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
        {"type":"event","name":"ValidatorRewarded","inputs":[{"name":"validatorId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"from","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"epoch","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false},
        {"type":"event","name":"ValidatorStatusChanged","inputs":[{"name":"validatorId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"flags","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false},
        {"type":"event","name":"Withdraw","inputs":[{"name":"validatorId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"delegator","type":"address","indexed":true,"internalType":"address"},{"name":"withdrawId","type":"uint8","indexed":false,"internalType":"uint8"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"withdrawEpoch","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false}
    ];
    private validatorContract?: any;

    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly rpcUrl: string,
                       protected readonly addresses: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, rpcUrl, addresses, validator);
        this.web3 = new Web3(process.env.EVM_API_URL);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            await Promise.all([
                this.updateEvmAddressBalance(this.addresses),
                this.updateValidatorRewards(this.validator)
            ]);
            customMetrics = await this.registry.metrics();
        } catch (e) {
            console.error('makeMetrics', e);
        }
        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    protected async updateEvmAddressBalance(addresses: string): Promise<void> {
        // Only native coin for Monad
        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        for (const address of evmAddresses) {
            const native = await this.getEVMAmount(address);
            this.availableGauge.labels(address, 'MON').set(native.amount);
        }
    }

    // Read validator unclaimed rewards via getValidator(validatorId) using ENV-provided validatorId
    protected async updateValidatorRewards(validatorAddress: string): Promise<void> {
        try {
            const contract = this.getValidatorContract();
            const validatorId = this.validatorIdEnv?.trim();
            if (!validatorId || validatorId.length === 0) {
                this.rewardsGauge.labels(validatorAddress, 'MON').set(0);
                return;
            }
            const res = await contract.methods.getValidator(validatorId).call();
            // res.unclaimedRewards is BigInt-like string
            const unclaimed: bigint = BigInt(res.unclaimedRewards?.toString?.() ?? res.unclaimedRewards ?? 0);
            const amount = parseInt(unclaimed.toString()) / Math.pow(10, this.decimalPlaces);
            this.rewardsGauge.labels(validatorAddress, 'MON').set(amount);
        } catch (e) {
            console.error('updateValidatorRewards error', e);
            this.rewardsGauge.labels(validatorAddress, 'MON').set(0);
        }
    }

    private getValidatorContract() {
        if (!this.validatorContract) {
            this.validatorContract = new this.web3.eth.Contract(this.validatorAbi as any, this.validatorContractAddress);
        }
        return this.validatorContract;
    }

    protected async getEVMAmount(address: string): Promise<{ amount: number }> {
        try {
            const amount = await this.web3.eth.getBalance(address);
            return {
                amount: parseInt(amount.toString()) / Math.pow(10, this.decimalPlaces)
            };
        } catch (e) {
            console.error(e);
            return { amount: 0 };
        }
    }
}


