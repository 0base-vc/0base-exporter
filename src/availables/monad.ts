import {Web3} from "web3";
import TargetAbstract from "../target.abstract";
import {Gauge, Registry} from "prom-client";

export default class Monad extends TargetAbstract {
    public readonly web3: Web3;

    private readonly metricPrefix = 'monad';
    protected readonly decimalPlaces = parseInt(process.env.DECIMAL_PLACES as any) || 18;
    private readonly registry = new Registry();
    private readonly availableGauge = new Gauge({
        name: `${this.metricPrefix}_address_available`,
        help: 'Available balance of address',
        labelNames: ['address', 'denom']
    });
    private readonly rewardsGauge = new Gauge({
        name: `${this.metricPrefix}_address_rewards`,
        help: 'Rewards of address',
        labelNames: ['address', 'denom']
    });
    private readonly stakeGauge = new Gauge({
        name: `${this.metricPrefix}_address_stake`,
        help: 'Stake (delegated amount) of validator',
        labelNames: ['address', 'denom']
    });
    private readonly commissionGauge = new Gauge({
        name: `${this.metricPrefix}_address_commission_rate`,
        help: 'Commission rate of validator (percentage)',
        labelNames: ['address', 'denom']
    });
    private readonly delegatedGauge = new Gauge({
        name: `${this.metricPrefix}_address_delegated`,
        help: 'Delegated balance of address',
        labelNames: ['address', 'denom']
    });
    private readonly unbondingGauge = new Gauge({
        name: `${this.metricPrefix}_address_unbonding`,
        help: 'Unbonding (withdrawal pending) balance of address',
        labelNames: ['address', 'denom']
    });
    private readonly epochGauge = new Gauge({
        name: `${this.metricPrefix}_epoch`,
        help: 'Current epoch number',
    });
    private readonly delegatorsCountGauge = new Gauge({
        name: `${this.metricPrefix}_validator_delegators_count`,
        help: 'Number of delegators for validator',
        labelNames: ['address']
    });
    private readonly consensusStakeGauge = new Gauge({
        name: `${this.metricPrefix}_validator_consensus_stake`,
        help: 'Consensus stake of validator',
        labelNames: ['address', 'denom']
    });
    private readonly consensusCommissionGauge = new Gauge({
        name: `${this.metricPrefix}_validator_consensus_commission_rate`,
        help: 'Consensus commission rate of validator (percentage)',
        labelNames: ['address', 'denom']
    });
    private readonly snapshotStakeGauge = new Gauge({
        name: `${this.metricPrefix}_validator_snapshot_stake`,
        help: 'Snapshot stake of validator',
        labelNames: ['address', 'denom']
    });
    private readonly snapshotCommissionGauge = new Gauge({
        name: `${this.metricPrefix}_validator_snapshot_commission_rate`,
        help: 'Snapshot commission rate of validator (percentage)',
        labelNames: ['address', 'denom']
    });
    private readonly validatorFlagsGauge = new Gauge({
        name: `${this.metricPrefix}_validator_flags`,
        help: 'Validator status flags',
        labelNames: ['address']
    });
    private readonly accRewardPerTokenGauge = new Gauge({
        name: `${this.metricPrefix}_validator_acc_reward_per_token`,
        help: 'Accumulated reward per token for validator',
        labelNames: ['address', 'denom']
    });
    private readonly delegatorRewardsGauge = new Gauge({
        name: `${this.metricPrefix}_address_delegator_rewards`,
        help: 'Unclaimed rewards for delegator address',
        labelNames: ['address', 'denom']
    });
    private readonly deltaStakeGauge = new Gauge({
        name: `${this.metricPrefix}_address_delta_stake`,
        help: 'Delta stake (pending change) for delegator address',
        labelNames: ['address', 'denom']
    });
    private readonly epochDelayPeriodGauge = new Gauge({
        name: `${this.metricPrefix}_epoch_delay_period`,
        help: 'Whether in epoch delay period (1 = yes, 0 = no)',
    });
    private readonly consensusValidatorSetCountGauge = new Gauge({
        name: `${this.metricPrefix}_validator_set_consensus_count`,
        help: 'Number of validators in consensus validator set',
    });
    private readonly executionValidatorSetCountGauge = new Gauge({
        name: `${this.metricPrefix}_validator_set_execution_count`,
        help: 'Number of validators in execution validator set',
    });
    private readonly snapshotValidatorSetCountGauge = new Gauge({
        name: `${this.metricPrefix}_validator_set_snapshot_count`,
        help: 'Number of validators in snapshot validator set',
    });
    private readonly validatorRankGauge = new Gauge({
        name: `${this.metricPrefix}_validator_rank`,
        help: 'Rank of validator by stake',
        labelNames: ['address']
    });
    private readonly proposerValIdGauge = new Gauge({
        name: `${this.metricPrefix}_proposer_validator_id`,
        help: 'Current proposer validator ID',
    });
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
        this.registry.registerMetric(this.availableGauge);
        this.registry.registerMetric(this.rewardsGauge);
        this.registry.registerMetric(this.stakeGauge);
        this.registry.registerMetric(this.commissionGauge);
        this.registry.registerMetric(this.delegatedGauge);
        this.registry.registerMetric(this.unbondingGauge);
        this.registry.registerMetric(this.epochGauge);
        this.registry.registerMetric(this.delegatorsCountGauge);
        this.registry.registerMetric(this.consensusStakeGauge);
        this.registry.registerMetric(this.consensusCommissionGauge);
        this.registry.registerMetric(this.snapshotStakeGauge);
        this.registry.registerMetric(this.snapshotCommissionGauge);
        this.registry.registerMetric(this.validatorFlagsGauge);
        this.registry.registerMetric(this.accRewardPerTokenGauge);
        this.registry.registerMetric(this.delegatorRewardsGauge);
        this.registry.registerMetric(this.deltaStakeGauge);
        this.registry.registerMetric(this.epochDelayPeriodGauge);
        this.registry.registerMetric(this.consensusValidatorSetCountGauge);
        this.registry.registerMetric(this.executionValidatorSetCountGauge);
        this.registry.registerMetric(this.snapshotValidatorSetCountGauge);
        this.registry.registerMetric(this.validatorRankGauge);
        this.registry.registerMetric(this.proposerValIdGauge);
    }

    public async makeMetrics(): Promise<string> {
        let customMetrics = '';
        try {
            await Promise.all([
                this.updateEvmAddressBalance(this.addresses),
                this.updateValidatorRewards(this.validator),
                this.updateAddressDelegations(this.addresses),
                this.updateAddressUnbonding(this.addresses),
                this.updateEpoch(),
                this.updateDelegatorsCount(this.validator),
                this.updateAddressDelegatorRewards(this.addresses),
                this.updateValidatorSets(),
                this.updateProposerValId()
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

    // Read validator unclaimed rewards, stake, and commission via getValidator(validatorId) using ENV-provided validatorId
    protected async updateValidatorRewards(validatorAddress: string): Promise<void> {
        try {
            const contract = this.getValidatorContract();
            const validatorId = this.validatorIdEnv?.trim();
            if (!validatorId || validatorId.length === 0) {
                this.rewardsGauge.labels(validatorAddress, 'MON').set(0);
                this.stakeGauge.labels(validatorAddress, 'MON').set(0);
                this.commissionGauge.labels(validatorAddress, 'MON').set(0);
                return;
            }
            const res = await contract.methods.getValidator(validatorId).call();
            // res.unclaimedRewards is BigInt-like string
            const unclaimed: bigint = BigInt(res.unclaimedRewards?.toString?.() ?? res.unclaimedRewards ?? 0);
            const rewardsAmount = parseInt(unclaimed.toString()) / Math.pow(10, this.decimalPlaces);
            this.rewardsGauge.labels(validatorAddress, 'MON').set(rewardsAmount);
            
            // res.stake is BigInt-like string
            const stake: bigint = BigInt(res.stake?.toString?.() ?? res.stake ?? 0);
            const stakeAmount = parseInt(stake.toString()) / Math.pow(10, this.decimalPlaces);
            this.stakeGauge.labels(validatorAddress, 'MON').set(stakeAmount);
            
            // res.commission is BigInt-like string (stored with 18 decimals, convert to percentage)
            const commission: bigint = BigInt(res.commission?.toString?.() ?? res.commission ?? 0);
            // Commission is stored with 18 decimals, convert to percentage rate
            const commissionAmount = parseInt(commission.toString()) * 100 / 1e18;
            this.commissionGauge.labels(validatorAddress, 'MON').set(commissionAmount);
            
            // res.consensusStake
            const consensusStake: bigint = BigInt(res.consensusStake?.toString?.() ?? res.consensusStake ?? 0);
            const consensusStakeAmount = parseInt(consensusStake.toString()) / Math.pow(10, this.decimalPlaces);
            this.consensusStakeGauge.labels(validatorAddress, 'MON').set(consensusStakeAmount);
            
            // res.consensusCommission
            const consensusCommission: bigint = BigInt(res.consensusCommission?.toString?.() ?? res.consensusCommission ?? 0);
            const consensusCommissionAmount = parseInt(consensusCommission.toString()) * 100 / 1e18;
            this.consensusCommissionGauge.labels(validatorAddress, 'MON').set(consensusCommissionAmount);
            
            // res.snapshotStake
            const snapshotStake: bigint = BigInt(res.snapshotStake?.toString?.() ?? res.snapshotStake ?? 0);
            const snapshotStakeAmount = parseInt(snapshotStake.toString()) / Math.pow(10, this.decimalPlaces);
            this.snapshotStakeGauge.labels(validatorAddress, 'MON').set(snapshotStakeAmount);
            
            // res.snapshotCommission
            const snapshotCommission: bigint = BigInt(res.snapshotCommission?.toString?.() ?? res.snapshotCommission ?? 0);
            const snapshotCommissionAmount = parseInt(snapshotCommission.toString()) * 100 / 1e18;
            this.snapshotCommissionGauge.labels(validatorAddress, 'MON').set(snapshotCommissionAmount);
            
            // res.flags
            const flags: bigint = BigInt(res.flags?.toString?.() ?? res.flags ?? 0);
            this.validatorFlagsGauge.labels(validatorAddress).set(parseInt(flags.toString()));
            
            // res.accRewardPerToken
            const accRewardPerToken: bigint = BigInt(res.accRewardPerToken?.toString?.() ?? res.accRewardPerToken ?? 0);
            const accRewardPerTokenAmount = parseInt(accRewardPerToken.toString()) / Math.pow(10, this.decimalPlaces);
            this.accRewardPerTokenGauge.labels(validatorAddress, 'MON').set(accRewardPerTokenAmount);
        } catch (e) {
            console.error('updateValidatorRewards error', e);
            this.rewardsGauge.labels(validatorAddress, 'MON').set(0);
            this.stakeGauge.labels(validatorAddress, 'MON').set(0);
            this.commissionGauge.labels(validatorAddress, 'MON').set(0);
            this.consensusStakeGauge.labels(validatorAddress, 'MON').set(0);
            this.consensusCommissionGauge.labels(validatorAddress, 'MON').set(0);
            this.snapshotStakeGauge.labels(validatorAddress, 'MON').set(0);
            this.snapshotCommissionGauge.labels(validatorAddress, 'MON').set(0);
            this.validatorFlagsGauge.labels(validatorAddress).set(0);
            this.accRewardPerTokenGauge.labels(validatorAddress, 'MON').set(0);
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

    // Update delegated balance for each address by querying all delegations
    protected async updateAddressDelegations(addresses: string): Promise<void> {
        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        const contract = this.getValidatorContract();
        
        for (const address of evmAddresses) {
            try {
                let totalDelegated = 0;
                let startValId = 0;
                let isDone = false;
                
                // Iterate through all delegations for this address
                while (!isDone) {
                    const res = await contract.methods.getDelegations(address, startValId).call();
                    isDone = res.isDone;
                    startValId = parseInt(res.nextValId?.toString() ?? res.nextValId ?? 0);
                    
                    // For each validator ID, get the delegator's stake
                    for (const valId of res.valIds || []) {
                        try {
                            const delegatorRes = await contract.methods.getDelegator(valId, address).call();
                            const stake: bigint = BigInt(delegatorRes.stake?.toString?.() ?? delegatorRes.stake ?? 0);
                            totalDelegated += parseInt(stake.toString()) / Math.pow(10, this.decimalPlaces);
                        } catch (e) {
                            console.error(`Error getting delegator info for validator ${valId}`, e);
                        }
                    }
                }
                
                this.delegatedGauge.labels(address, 'MON').set(totalDelegated);
            } catch (e) {
                console.error(`Error updating delegations for address ${address}`, e);
                this.delegatedGauge.labels(address, 'MON').set(0);
            }
        }
    }

    // Update unbonding (withdrawal pending) balance for each address
    protected async updateAddressUnbonding(addresses: string): Promise<void> {
        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        const contract = this.getValidatorContract();
        const validatorId = this.validatorIdEnv?.trim();
        
        if (!validatorId || validatorId.length === 0) {
            // If no validator ID, set all to 0
            for (const address of evmAddresses) {
                this.unbondingGauge.labels(address, 'MON').set(0);
            }
            return;
        }
        
        for (const address of evmAddresses) {
            try {
                let totalUnbonding = 0;
                // Check withdrawal requests (withdrawId can be 0-255, but typically 0-2 are used)
                // We'll check common withdrawId values (0, 1, 2)
                for (let withdrawId = 0; withdrawId < 3; withdrawId++) {
                    try {
                        const res = await contract.methods.getWithdrawalRequest(validatorId, address, withdrawId).call();
                        const withdrawalAmount: bigint = BigInt(res.withdrawalAmount?.toString?.() ?? res.withdrawalAmount ?? 0);
                        if (withdrawalAmount > 0) {
                            totalUnbonding += parseInt(withdrawalAmount.toString()) / Math.pow(10, this.decimalPlaces);
                        }
                    } catch (e) {
                        // Withdrawal request might not exist for this withdrawId, continue
                    }
                }
                
                this.unbondingGauge.labels(address, 'MON').set(totalUnbonding);
            } catch (e) {
                console.error(`Error updating unbonding for address ${address}`, e);
                this.unbondingGauge.labels(address, 'MON').set(0);
            }
        }
    }

    // Update current epoch information
    protected async updateEpoch(): Promise<void> {
        try {
            const contract = this.getValidatorContract();
            const res = await contract.methods.getEpoch().call();
            const epoch: bigint = BigInt(res.epoch?.toString?.() ?? res.epoch ?? 0);
            this.epochGauge.set(parseInt(epoch.toString()));
            
            // inEpochDelayPeriod
            const inDelayPeriod = res.inEpochDelayPeriod === true || res.inEpochDelayPeriod === 'true' || res.inEpochDelayPeriod === 1;
            this.epochDelayPeriodGauge.set(inDelayPeriod ? 1 : 0);
        } catch (e) {
            console.error('updateEpoch error', e);
        }
    }

    // Update delegators count for validator
    protected async updateDelegatorsCount(validatorAddress: string): Promise<void> {
        try {
            const contract = this.getValidatorContract();
            const validatorId = this.validatorIdEnv?.trim();
            if (!validatorId || validatorId.length === 0) {
                this.delegatorsCountGauge.labels(validatorAddress).set(0);
                return;
            }
            
            let totalDelegators = 0;
            let startDelegator = '0x0000000000000000000000000000000000000000';
            let isDone = false;
            
            // Iterate through all delegators
            while (!isDone) {
                const res = await contract.methods.getDelegators(validatorId, startDelegator).call();
                isDone = res.isDone;
                startDelegator = res.nextDelegator || '0x0000000000000000000000000000000000000000';
                totalDelegators += (res.delegators || []).length;
            }
            
            this.delegatorsCountGauge.labels(validatorAddress).set(totalDelegators);
        } catch (e) {
            console.error('updateDelegatorsCount error', e);
            this.delegatorsCountGauge.labels(validatorAddress).set(0);
        }
    }

    // Update delegator rewards and delta stake for each address
    protected async updateAddressDelegatorRewards(addresses: string): Promise<void> {
        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        const contract = this.getValidatorContract();
        const validatorId = this.validatorIdEnv?.trim();
        
        if (!validatorId || validatorId.length === 0) {
            for (const address of evmAddresses) {
                this.delegatorRewardsGauge.labels(address, 'MON').set(0);
                this.deltaStakeGauge.labels(address, 'MON').set(0);
            }
            return;
        }
        
        for (const address of evmAddresses) {
            try {
                const res = await contract.methods.getDelegator(validatorId, address).call();
                
                // unclaimedRewards
                const unclaimedRewards: bigint = BigInt(res.unclaimedRewards?.toString?.() ?? res.unclaimedRewards ?? 0);
                const rewardsAmount = parseInt(unclaimedRewards.toString()) / Math.pow(10, this.decimalPlaces);
                this.delegatorRewardsGauge.labels(address, 'MON').set(rewardsAmount);
                
                // deltaStake
                const deltaStake: bigint = BigInt(res.deltaStake?.toString?.() ?? res.deltaStake ?? 0);
                const deltaStakeAmount = parseInt(deltaStake.toString()) / Math.pow(10, this.decimalPlaces);
                this.deltaStakeGauge.labels(address, 'MON').set(deltaStakeAmount);
            } catch (e) {
                console.error(`Error updating delegator rewards for address ${address}`, e);
                this.delegatorRewardsGauge.labels(address, 'MON').set(0);
                this.deltaStakeGauge.labels(address, 'MON').set(0);
            }
        }
    }

    // Update validator set counts and validator rank
    protected async updateValidatorSets(): Promise<void> {
        try {
            const contract = this.getValidatorContract();
            const validatorId = this.validatorIdEnv?.trim();
            
            // Get all validators from each set and count them
            const consensusValidators = await this.getAllValidatorsFromSet(contract, 'getConsensusValidatorSet');
            this.consensusValidatorSetCountGauge.set(consensusValidators.length);
            
            const executionValidators = await this.getAllValidatorsFromSet(contract, 'getExecutionValidatorSet');
            this.executionValidatorSetCountGauge.set(executionValidators.length);
            
            const snapshotValidators = await this.getAllValidatorsFromSet(contract, 'getSnapshotValidatorSet');
            this.snapshotValidatorSetCountGauge.set(snapshotValidators.length);
            
            // Calculate validator rank based on stake (using consensus set)
            if (validatorId && consensusValidators.length > 0) {
                // Get stake for each validator and sort
                const validatorStakes: Array<{ id: string, stake: number }> = [];
                for (const valId of consensusValidators) {
                    try {
                        const res = await contract.methods.getValidator(valId).call();
                        const stake: bigint = BigInt(res.stake?.toString?.() ?? res.stake ?? 0);
                        validatorStakes.push({
                            id: valId.toString(),
                            stake: parseInt(stake.toString())
                        });
                    } catch (e) {
                        // Skip if can't get validator info
                    }
                }
                
                // Sort by stake descending
                validatorStakes.sort((a, b) => b.stake - a.stake);
                
                // Find rank (1-based)
                const rank = validatorStakes.findIndex(v => v.id === validatorId) + 1;
                if (rank > 0) {
                    this.validatorRankGauge.labels(this.validator).set(rank);
                } else {
                    this.validatorRankGauge.labels(this.validator).set(0);
                }
            } else {
                this.validatorRankGauge.labels(this.validator).set(0);
            }
        } catch (e) {
            console.error('updateValidatorSets error', e);
        }
    }

    // Helper method to get all validators from a validator set
    private async getAllValidatorsFromSet(contract: any, methodName: string): Promise<string[]> {
        const allValidators: string[] = [];
        let startIndex = 0;
        let isDone = false;
        
        while (!isDone) {
            try {
                const res = await contract.methods[methodName](startIndex).call();
                isDone = res.isDone;
                startIndex = parseInt(res.nextIndex?.toString() ?? res.nextIndex ?? 0);
                
                if (res.valIds && Array.isArray(res.valIds)) {
                    for (const valId of res.valIds) {
                        allValidators.push(valId.toString());
                    }
                }
            } catch (e) {
                console.error(`Error getting validators from ${methodName}`, e);
                break;
            }
        }
        
        return allValidators;
    }

    // Update current proposer validator ID
    protected async updateProposerValId(): Promise<void> {
        try {
            const contract = this.getValidatorContract();
            const res = await contract.methods.getProposerValId().call();
            const proposerValId: bigint = BigInt(res.val_id?.toString() ?? res.val_id ?? 0);
            this.proposerValIdGauge.set(parseInt(proposerValId.toString()));
        } catch (e) {
            console.error('updateProposerValId error', e);
        }
    }
}


