import type { Web3 } from "web3";
import { Gauge } from "prom-client";
import Tendermint from "./tendermint-v1";
import * as _ from "lodash";
import { toDecimal } from "../core/decimal";
import EvmClient from "../core/evm-client";
import { getEvmApiUrl } from "../core/runtime-env";

function parseInteger(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseScaled(value: string | number | undefined, decimals: number): number {
  return toDecimal(String(value ?? 0), decimals);
}

export default class Mitosis extends Tendermint {
  public readonly web3: Web3;
  private readonly evmClient: EvmClient;
  private readonly gMitoContractAddress: string = "0x1248163272144FdbBbE6D1a8c43Ca56DE9bD5cEA";
  private gMitoDecimals: number | null = null;
  private readonly validatorRewardDistributorContractAddress: string =
    "0x124816321ac3a7F3A68Cf2D36876e670beaBC6c7";

  protected readonly erc20BalanceGauge = new Gauge({
    name: `${this.metricPrefix}_erc20_balance`,
    help: "ERC20 token balance",
    labelNames: ["address", "contractAddress", "token", "symbol"],
  });

  protected readonly validatorsCollateralGauge = new Gauge({
    name: `${this.metricPrefix}_validators_collateral`,
    help: "Validators collateral amount",
    labelNames: ["address", "moniker"],
  });

  protected readonly validatorsExtraVotingPowerGauge = new Gauge({
    name: `${this.metricPrefix}_validators_extra_voting_power`,
    help: "Validators extra voting power",
    labelNames: ["address", "moniker"],
  });

  protected readonly validatorsVotingPowerGauge = new Gauge({
    name: `${this.metricPrefix}_validators_voting_power`,
    help: "Validators voting power",
    labelNames: ["address", "moniker"],
  });

  protected readonly validatorsCommissionRateGauge = new Gauge({
    name: `${this.metricPrefix}_validators_commission_rate`,
    help: "Validators commission rate",
    labelNames: ["address", "moniker"],
  });

  protected readonly validatorsPendingCommissionRateGauge = new Gauge({
    name: `${this.metricPrefix}_validators_pending_commission_rate`,
    help: "Validators pending commission rate",
    labelNames: ["address", "moniker"],
  });

  protected readonly validatorsPendingCommissionRateUpdateEpochGauge = new Gauge({
    name: `${this.metricPrefix}_validators_pending_commission_rate_update_epoch`,
    help: "Validators pending commission rate update epoch",
    labelNames: ["address", "moniker"],
  });

  private readonly validatorManagerContractAddress: string =
    "0x12481632e81c446ecFa1CD8F93df4DebC8F5ACd2";

  public constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly addresses: string,
    protected readonly validator: string,
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator);

    this.evmClient = new EvmClient(getEvmApiUrl());
    this.web3 = this.evmClient.web3;
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

    let customMetrics = "";
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
      console.error("makeMetrics", e);
    }

    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  protected async updateRank(validator: string): Promise<void> {
    const url = `${this.apiUrl}/mitosis/evmvalidator/v1/validators`;

    return this.get(url, (response: { data: any }) => {
      const sorted = _.sortBy(response.data.validators, (o: any) => {
        return parseInteger(o.collateral_shares);
      }).reverse();

      const rank =
        _.findIndex(sorted, (o: any) => {
          return o.addr.toLowerCase() === validator.toLowerCase();
        }) + 1;

      const me = sorted[rank - 1];
      const above = sorted[rank - 2] || { collateral_shares: me.collateral_shares };
      const below = sorted[rank] || { collateral_shares: "0" };

      this.rankGauge.labels(validator).set(rank);
      this.rivalsPowerGauge
        .labels("above")
        .set(parseScaled(above.collateral_shares, this.decimalPlaces));
      this.rivalsPowerGauge
        .labels("below")
        .set(parseScaled(below.collateral_shares, this.decimalPlaces));
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
        // Fetch all validator details in a single contract call.
        await this.updateValidatorInfo(validator);
      }
    });
  }

  protected async updateEvmAddressBalance(addresses: string): Promise<void> {
    this.erc20BalanceGauge.reset();

    const evmAddresses = addresses.split(",").filter((address) => address.startsWith("0x"));
    for (const address of evmAddresses) {
      // Fetch the native token balance.
      const mito = await this.getEVMAmount(address);
      this.availableGauge.labels(address, "MITO").set(mito.amount);

      // Fetch the gMITO ERC20 balance using the configured contract address.
      if (this.gMitoContractAddress) {
        try {
          const tokenContract = new this.web3.eth.Contract(
            this.erc20Abi as any,
            this.gMitoContractAddress,
          );
          if (this.gMitoDecimals == null) {
            const decimals: number = await tokenContract.methods.decimals().call();
            this.gMitoDecimals = Number(decimals) || 18;
          }
          const balance: bigint = await tokenContract.methods.balanceOf(address).call();
          const amount = this.evmClient.scale(balance.toString(), this.gMitoDecimals);
          this.availableGauge.labels(address, "gMITO").set(amount);
        } catch (e) {
          console.error("gMITO balance fetch error", e);
        }
      }
    }
  }

  protected async updateOperatorCommission(validator: string): Promise<void> {
    if (!this.validatorRewardDistributorContractAddress) return;
    try {
      const abi = [
        {
          inputs: [{ internalType: "address", name: "operator", type: "address" }],
          name: "claimableOperatorRewards",
          outputs: [
            { internalType: "uint256", name: "", type: "uint256" },
            { internalType: "uint256", name: "", type: "uint256" },
          ],
          stateMutability: "view",
          type: "function",
        },
      ];
      const contract = new this.web3.eth.Contract(
        abi as any,
        this.validatorRewardDistributorContractAddress,
      );
      const result: [string, string] = await contract.methods
        .claimableOperatorRewards(validator)
        .call();
      const primary = this.evmClient.scale(result[0].toString(), this.decimalPlaces);
      this.commissionGauge.labels(validator, "gMITO").set(primary);
    } catch (e) {
      console.error("updateOperatorCommission error", e);
    }
  }

  // Reuse the validator manager contract instance across scrapes.
  private validatorManagerContract?: any;

  // Minimal ERC20 ABI for the functions used by this collector.
  private readonly erc20Abi = [
    {
      inputs: [],
      name: "decimals",
      outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [{ internalType: "address", name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ];

  // Minimal validator manager ABI used to load validator metadata.
  private readonly validatorManagerAbi = [
    {
      type: "function",
      name: "validatorInfo",
      inputs: [
        {
          name: "valAddr",
          type: "address",
          internalType: "address",
        },
      ],
      outputs: [
        {
          name: "",
          type: "tuple",
          internalType: "struct IValidatorManager.ValidatorInfoResponse",
          components: [
            {
              name: "valAddr",
              type: "address",
              internalType: "address",
            },
            {
              name: "pubKey",
              type: "bytes",
              internalType: "bytes",
            },
            {
              name: "operator",
              type: "address",
              internalType: "address",
            },
            {
              name: "rewardManager",
              type: "address",
              internalType: "address",
            },
            {
              name: "commissionRate",
              type: "uint256",
              internalType: "uint256",
            },
            {
              name: "pendingCommissionRate",
              type: "uint256",
              internalType: "uint256",
            },
            {
              name: "pendingCommissionRateUpdateEpoch",
              type: "uint256",
              internalType: "uint256",
            },
            {
              name: "metadata",
              type: "bytes",
              internalType: "bytes",
            },
          ],
        },
      ],
      stateMutability: "view",
    },
  ];

  private getValidatorManagerContract() {
    if (!this.validatorManagerContract) {
      this.validatorManagerContract = new this.web3.eth.Contract(
        this.validatorManagerAbi as any,
        this.validatorManagerContractAddress,
      );
    }
    return this.validatorManagerContract;
  }

  private async updateValidatorInfo(validator: any): Promise<void> {
    try {
      // Load validator details from the smart contract.
      const contract = this.getValidatorManagerContract();
      const result = await contract.methods.validatorInfo(validator.addr).call();

      // Parse metadata and extract the moniker when possible.
      const metadata = this.parseMetadataToJson(result.metadata);
      const moniker = metadata?.name || "Unknown";

      // Update the base validator power gauges from API data, including the moniker label.
      this.validatorsGauge.labels(validator.addr).set(parseInteger(validator.collateral_shares));
      this.validatorsCollateralGauge
        .labels(validator.addr, moniker)
        .set(parseInteger(validator.collateral));
      this.validatorsExtraVotingPowerGauge
        .labels(validator.addr, moniker)
        .set(parseInteger(validator.extra_voting_power));
      this.validatorsVotingPowerGauge
        .labels(validator.addr, moniker)
        .set(parseInteger(validator.voting_power));

      // Update commission-rate gauges from contract data.
      const commissionRatePercent = Number((parseInteger(result.commissionRate) / 100).toFixed(2));
      const pendingCommissionRatePercent = Number(
        (parseInteger(result.pendingCommissionRate) / 100).toFixed(2),
      );
      const pendingCommissionRateUpdateEpoch = parseInteger(
        result.pendingCommissionRateUpdateEpoch,
      );

      this.validatorsCommissionRateGauge.labels(validator.addr, moniker).set(commissionRatePercent);
      this.validatorsPendingCommissionRateGauge
        .labels(validator.addr, moniker)
        .set(pendingCommissionRatePercent);
      this.validatorsPendingCommissionRateUpdateEpochGauge
        .labels(validator.addr, moniker)
        .set(pendingCommissionRateUpdateEpoch);
    } catch (e) {
      console.error(`Error fetching validator info for ${validator.addr}:`, e);
      // Fall back to default values when contract reads fail.
      const fallbackMoniker = "Unknown";
      this.validatorsGauge.labels(validator.addr).set(parseInteger(validator.collateral_shares));
      this.validatorsCollateralGauge
        .labels(validator.addr, fallbackMoniker)
        .set(parseInteger(validator.collateral));
      this.validatorsExtraVotingPowerGauge
        .labels(validator.addr, fallbackMoniker)
        .set(parseInteger(validator.extra_voting_power));
      this.validatorsVotingPowerGauge
        .labels(validator.addr, fallbackMoniker)
        .set(parseInteger(validator.voting_power));
      this.validatorsCommissionRateGauge.labels(validator.addr, fallbackMoniker).set(0);
      this.validatorsPendingCommissionRateGauge.labels(validator.addr, fallbackMoniker).set(0);
      this.validatorsPendingCommissionRateUpdateEpochGauge
        .labels(validator.addr, fallbackMoniker)
        .set(0);
    }
  }

  private parseMetadataToJson(metadataHex: string): any {
    try {
      if (!metadataHex || metadataHex === "0x") {
        return null;
      }

      // Convert bytes to a UTF-8 string.
      const hex = metadataHex.slice(2); // Remove the 0x prefix.
      const metadataString = Buffer.from(hex, "hex").toString("utf8");

      // Remove null bytes before parsing.
      const cleanedString = metadataString.replace(/\0/g, "");

      if (!cleanedString.trim()) {
        return null;
      }

      // Attempt to parse JSON metadata first.
      return JSON.parse(cleanedString);
    } catch (e) {
      console.error("Metadata JSON parsing error:", e);
      // Fall back to plain-text parsing when JSON parsing fails.
      try {
        const hex = metadataHex.slice(2);
        const plainText = Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "");
        return { name: plainText.trim() || "Unknown" };
      } catch (fallbackError) {
        console.error("Metadata fallback parsing error:", fallbackError);
        return { name: "Unknown" };
      }
    }
  }

  //curl -X POST -H "Content-Type: application/json" https://berachain-v2-testnet-node-web3.1xp.vc -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x7A9Ba30e544d2b6F1cD11709e9F0a5C57A779e94", "latest"],"id":1}'
  //curl -X POST -H "Content-Type: application/json" http://localhost:8545 -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x7A9Ba30e544d2b6F1cD11709e9F0a5C57A779e94", "latest"],"id":1}'
  protected async getEVMAmount(address: string): Promise<{
    amount: number;
  }> {
    try {
      const amount = await this.evmClient.getNativeBalance(address, this.decimalPlaces);
      return {
        amount,
      };
    } catch (e) {
      console.error(e);
      return {
        amount: 0,
      };
    }
  }
}
