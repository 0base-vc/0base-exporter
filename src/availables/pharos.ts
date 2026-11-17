import { Gauge, Registry } from "prom-client";
import type { Web3 } from "web3";
import EvmClient from "../core/evm-client";
import { getEvmApiUrl } from "../core/runtime-env";
import { toDecimal } from "../core/decimal";
import TargetAbstract from "../target.abstract";

const STAKING_CONTRACT_ADDRESS = "0x4100000000000000000000000000000000000000";
const PROS_DECIMALS = 18;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const STAKING_ABI = [
  {
    type: "function",
    name: "getValidator",
    inputs: [{ name: "_poolId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      {
        name: "validator",
        type: "tuple",
        internalType: "struct IStaking.Validator",
        components: [
          { name: "description", type: "string", internalType: "string" },
          { name: "publicKey", type: "string", internalType: "string" },
          { name: "publicKeyPop", type: "string", internalType: "string" },
          { name: "blsPublicKey", type: "string", internalType: "string" },
          { name: "blsPublicKeyPop", type: "string", internalType: "string" },
          { name: "endpoint", type: "string", internalType: "string" },
          { name: "status", type: "uint8", internalType: "uint8" },
          { name: "poolId", type: "bytes32", internalType: "bytes32" },
          { name: "totalStake", type: "uint256", internalType: "uint256" },
          { name: "owner", type: "address", internalType: "address" },
          { name: "stakeSnapshot", type: "uint256", internalType: "uint256" },
          { name: "pendingWithdrawStake", type: "uint256", internalType: "uint256" },
          { name: "pendingWithdrawWindow", type: "uint8", internalType: "uint8" },
          { name: "pendingOwner", type: "address", internalType: "address" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getDelegatorReward",
    inputs: [
      { name: "_poolId", type: "bytes32", internalType: "bytes32" },
      { name: "_delegator", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCommissionRate",
    inputs: [{ name: "_poolId", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
];

interface ValidatorView {
  owner?: string;
  poolId?: string;
  [index: number]: unknown;
}

export default class Pharos extends TargetAbstract {
  private readonly web3: Web3;
  private readonly contract: any;
  private readonly poolIds: string[];
  private readonly registry = new Registry();

  private readonly unclaimedRewardsGauge = new Gauge({
    name: "pharos_validator_owner_unclaimed_rewards_pros",
    help: "Unclaimed validator commission plus any rewards from the validator owner's own stake, in PROS",
    labelNames: ["pool_id"],
    registers: [],
  });

  private readonly commissionRateGauge = new Gauge({
    name: "pharos_validator_commission_rate_percent",
    help: "Validator commission rate in percent",
    labelNames: ["pool_id"],
    registers: [],
  });

  private readonly rewardsAvailableGauge = new Gauge({
    name: "pharos_validator_unclaimed_rewards_available",
    help: "Whether unclaimed rewards and commission data were read successfully for this validator",
    labelNames: ["pool_id"],
    registers: [],
  });

  public constructor(
    existMetrics: string,
    apiUrl: string,
    rpcUrl: string,
    addresses: string,
    validator: string,
    evmApiUrl: string = getEvmApiUrl(),
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator);

    this.poolIds = [
      ...new Set(
        validator
          .split(",")
          .map((poolId) => poolId.trim())
          .filter(Boolean),
      ),
    ];
    if (this.poolIds.length === 0) {
      throw new Error("VALIDATOR must contain one or more Pharos validator pool IDs");
    }
    const invalidPoolId = this.poolIds.find((poolId) => !/^0x[0-9a-fA-F]{64}$/.test(poolId));
    if (invalidPoolId) {
      throw new Error(`Invalid Pharos validator pool ID "${invalidPoolId}"; expected bytes32 hex`);
    }

    this.web3 = new EvmClient(evmApiUrl).web3;
    this.contract = new this.web3.eth.Contract(STAKING_ABI as any, STAKING_CONTRACT_ADDRESS);
    this.registry.registerMetric(this.unclaimedRewardsGauge);
    this.registry.registerMetric(this.commissionRateGauge);
    this.registry.registerMetric(this.rewardsAvailableGauge);
  }

  public async makeMetrics(): Promise<string> {
    await Promise.all(this.poolIds.map((poolId) => this.updateValidatorMetrics(poolId)));
    const customMetrics = await this.registry.metrics();
    return `${customMetrics}\n${await this.loadExistMetrics()}`;
  }

  protected async readValidatorOwner(poolId: string): Promise<string> {
    const validator = (await this.contract.methods.getValidator(poolId).call()) as ValidatorView;
    const returnedPoolId = validator.poolId ?? validator[7];
    if (
      typeof returnedPoolId === "string" &&
      returnedPoolId.toLowerCase() !== poolId.toLowerCase()
    ) {
      throw new Error(`Pharos returned no validator for pool ${poolId}`);
    }

    const owner = validator.owner ?? validator[9];
    if (typeof owner !== "string" || !this.web3.utils.isAddress(owner)) {
      throw new Error(`Pharos returned an invalid owner for pool ${poolId}`);
    }
    if (owner.toLowerCase() === ZERO_ADDRESS) {
      throw new Error(`Pharos returned no validator owner for pool ${poolId}`);
    }

    return owner;
  }

  protected async readOwnerUnclaimedRewards(
    poolId: string,
    owner: string,
  ): Promise<bigint | number | string> {
    return this.contract.methods.getDelegatorReward(poolId, owner).call();
  }

  protected async readCommissionRate(poolId: string): Promise<bigint | number | string> {
    return this.contract.methods.getCommissionRate(poolId).call();
  }

  private async updateValidatorMetrics(poolId: string): Promise<void> {
    try {
      const owner = await this.readValidatorOwner(poolId);
      const [rawRewards, rawCommissionRate] = await Promise.all([
        this.readOwnerUnclaimedRewards(poolId, owner),
        this.readCommissionRate(poolId),
      ]);
      const rewards = toDecimal(String(rawRewards), PROS_DECIMALS);
      const commissionRate = Number(rawCommissionRate) / 100;
      if (!Number.isFinite(rewards) || !Number.isFinite(commissionRate)) {
        throw new Error(`Pharos returned non-finite reward data for pool ${poolId}`);
      }

      this.unclaimedRewardsGauge.labels(poolId).set(rewards);
      this.commissionRateGauge.labels(poolId).set(commissionRate);
      this.rewardsAvailableGauge.labels(poolId).set(1);
    } catch (error) {
      console.error(`Pharos reward query failed for pool ${poolId}`, error);
      this.unclaimedRewardsGauge.remove(poolId);
      this.commissionRateGauge.remove(poolId);
      this.rewardsAvailableGauge.labels(poolId).set(0);
    }
  }
}
