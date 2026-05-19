import type { Web3 } from "web3";
import { Gauge } from "prom-client";
import Tendermint from "../tendermint-v1";
import * as _ from "lodash";
import { toDecimal } from "../../core/decimal";
import EvmClient from "../../core/evm-client";
import { getEvmApiUrl } from "../../core/runtime-env";

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

  protected readonly erc20BalanceGauge = new Gauge({
    name: `${this.metricPrefix}_erc20_balance`,
    help: "ERC20 token balance",
    labelNames: ["address", "contractAddress", "token", "symbol"],
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
    this.registry.registerMetric(this.erc20BalanceGauge);
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
      ]);
      customMetrics = await this.registry.metrics();
    } catch (e) {
      console.error("makeMetrics", e);
    }

    return customMetrics + "\n" + (await this.loadExistMetrics());
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
      this.availableGauge.labels(address, "MITO").set(mito.amount);
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
