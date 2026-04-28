import type { Web3 } from "web3";
import { Gauge, Registry } from "prom-client";
import TargetAbstract from "../../target.abstract";
import * as _ from "lodash";
import * as TOML from "@iarna/toml";
import * as fs from "fs";
import * as path from "path";
import EvmClient from "../../core/evm-client";
import { getDecimalPlaces, getEvmApiUrl } from "../../core/runtime-env";

function parseInteger(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface HighQCInfo {
  id: string;
  round: number;
  epoch: number;
  parent_id: string;
  parent_round: number;
}

interface ForkpointData {
  root: string;
  high_qc: {
    signatures: string;
    info: HighQCInfo;
  };
  validator_sets?: Array<{
    epoch: number;
    round: number;
  }>;
}

export default class Monad extends TargetAbstract {
  protected readonly metricPrefix = "monad";
  protected readonly registry = new Registry();
  private readonly decimalPlaces = getDecimalPlaces(6);

  public readonly web3: Web3;
  private readonly evmClient: EvmClient;

  protected readonly erc20BalanceGauge = new Gauge({
    name: `${this.metricPrefix}_erc20_balance`,
    help: "ERC20 token balance",
    labelNames: ["address", "contractAddress", "token", "symbol"],
  });

  // Additional gauges used by the testnet collector.
  protected readonly availableGauge = new Gauge({
    name: `${this.metricPrefix}_address_available`,
    help: "Available balance of address",
    labelNames: ["address", "denom"],
  });

  protected readonly rankGauge = new Gauge({
    name: `${this.metricPrefix}_validator_rank`,
    help: "Your rank of validators",
    labelNames: ["validator"],
  });

  protected readonly rivalsPowerGauge = new Gauge({
    name: `${this.metricPrefix}_validator_power_rivals`,
    help: "Voting power of Rivals",
    labelNames: ["rank"],
  });

  protected readonly maxValidatorGauge = new Gauge({
    name: `${this.metricPrefix}_staking_parameters_max_validator_count`,
    help: "Limitation of validators count",
  });

  protected readonly validatorsGauge = new Gauge({
    name: `${this.metricPrefix}_validators_power`,
    help: "Validators power",
    labelNames: ["address"],
  });

  // Extra gauges sourced from forkpoint.toml.
  protected readonly epochGauge = new Gauge({
    name: `${this.metricPrefix}_current_epoch`,
    help: "Current epoch from forkpoint.toml",
  });

  protected readonly roundGauge = new Gauge({
    name: `${this.metricPrefix}_current_round`,
    help: "Current round from forkpoint.toml",
  });

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

    // Register every gauge in the shared registry.
    this.registry.registerMetric(this.erc20BalanceGauge);
    this.registry.registerMetric(this.availableGauge);
    this.registry.registerMetric(this.rankGauge);
    this.registry.registerMetric(this.rivalsPowerGauge);
    this.registry.registerMetric(this.maxValidatorGauge);
    this.registry.registerMetric(this.validatorsGauge);
    this.registry.registerMetric(this.epochGauge);
    this.registry.registerMetric(this.roundGauge);
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
        this.updateGaugesFromForkpoint(),
      ]);
      customMetrics = await this.registry.metrics();
    } catch (e) {
      console.error("makeMetrics", e);
    }

    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  // Read the TOML file safely, using a temp copy to avoid file-lock issues.
  private async readForkpointToml(retryCount: number = 3): Promise<ForkpointData | null> {
    const forkpointPath = "/home/monad/monad-bft/config/forkpoint/forkpoint.toml";

    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        // Create a temporary file path.
        const tempPath = path.join("/tmp", `forkpoint_${Date.now()}_${attempt}.toml`);

        // Copy the file to a temporary location to avoid lock contention.
        await fs.promises.copyFile(forkpointPath, tempPath);

        // Read the temporary file.
        const content = await fs.promises.readFile(tempPath, "utf8");

        // Remove the temporary file.
        await fs.promises.unlink(tempPath).catch(() => {
          // Ignore cleanup failures.
        });

        // Parse the TOML payload.
        const data = TOML.parse(content) as unknown as ForkpointData;
        return data;
      } catch (error) {
        console.error(`Attempt ${attempt + 1} to read forkpoint.toml failed:`, error);

        if (attempt < retryCount - 1) {
          // Wait briefly before retrying.
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }

    console.error(`Failed to read forkpoint.toml after ${retryCount} attempts`);
    return null;
  }

  protected async updateGaugesFromForkpoint(): Promise<void> {
    try {
      const forkpointData = await this.readForkpointToml();
      if (forkpointData && forkpointData.high_qc && forkpointData.high_qc.info) {
        const epoch = forkpointData.high_qc.info.epoch;
        const round = forkpointData.high_qc.info.round;

        this.epochGauge.set(epoch);
        this.roundGauge.set(round);

        console.log(`Updated epoch to: ${epoch}, round to: ${round}`);
      } else {
        console.error("Failed to read epoch and round from forkpoint.toml");
      }
    } catch (error) {
      console.error("Error updating epoch and round:", error);
    }
  }

  protected async updateRank(validator: string): Promise<void> {
    const url = `${this.apiUrl}/mitosis/evmvalidator/v1/validators`;

    return this.get(url, (response) => {
      const sorted = _.sortBy(response.data.validators, (o) => {
        return parseInteger(o.collateral_shares);
      }).reverse();

      const rank =
        _.findIndex(sorted, (o) => {
          return o.addr.toLowerCase() === validator.toLowerCase();
        }) + 1;

      const me = sorted[rank - 1];
      const above = sorted[rank - 2] || { collateral_shares: me.collateral_shares };
      const below = sorted[rank] || { collateral_shares: "0" };

      this.rankGauge.labels(validator).set(rank);
      this.rivalsPowerGauge.labels("above").set(parseInteger(above.collateral_shares));
      this.rivalsPowerGauge.labels("below").set(parseInteger(below.collateral_shares));
    });
  }

  protected async updateMaxValidator(): Promise<void> {
    const url = `${this.apiUrl}/mitosis/evmvalidator/v1/params`;

    return this.get(url, (response) => {
      const limit = response.data.params.max_validators;
      this.maxValidatorGauge.set(limit);
    });
  }

  protected async updateValidatorsPower(): Promise<void> {
    const url = `${this.apiUrl}/mitosis/evmvalidator/v1/validators`;

    return this.get(url, (response) => {
      const validators = response.data.validators;
      validators.forEach((validator: any) => {
        this.validatorsGauge.labels(validator.addr).set(parseInteger(validator.collateral_shares));
      });
    });
  }

  protected async updateEvmAddressBalance(addresses: string): Promise<void> {
    this.erc20BalanceGauge.reset();

    const evmAddresses = addresses.split(",").filter((address) => address.startsWith("0x"));
    for (const address of evmAddresses) {
      // Fetch the native token balance.
      const mito = await this.getEVMAmount(address);
      this.availableGauge.labels(address, "MON").set(mito.amount);
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
