import type { Web3 } from "web3";
import { Gauge } from "prom-client";
import Tendermint from "./tendermint-v1";
import axios from "axios";
import EvmClient from "../core/evm-client";
import { getAlchemyApiKey, getEvmApiUrl } from "../core/runtime-env";

interface ERC20TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

export default class Berachain extends Tendermint {
  public readonly web3: Web3;
  private readonly evmClient: EvmClient;
  private tokenScanTimer?: NodeJS.Timeout;

  protected readonly BGTContractAddress = "0x656b95E550C07a9ffe548bd4085c72418Ceb1dba";
  protected readonly BGTStakerContractAddress = "0x44F07Ce5AfeCbCC406e6beFD40cc2998eEb8c7C6";
  private readonly BGTContract;
  private readonly BGTStakerContract;
  private readonly alchemyApiUrl = "https://berachain-mainnet.g.alchemy.com/v2/";
  private readonly alchemyApiKey = getAlchemyApiKey();
  private erc20Metadata: Map<string, ERC20TokenMetadata> = new Map();

  protected readonly boostedGauge = new Gauge({
    name: `${this.metricPrefix}_validator_boosted`,
    help: "Boosted balance of validator",
    labelNames: ["validator", "denom"],
  });

  protected readonly earnedHoneyGauge = new Gauge({
    name: `${this.metricPrefix}_earned_honey`,
    help: "Earned Honey of validator",
    labelNames: ["address", "denom"],
  });

  protected readonly erc20BalanceGauge = new Gauge({
    name: `${this.metricPrefix}_erc20_balance`,
    help: "ERC20 token balance",
    labelNames: ["address", "contractAddress", "token", "symbol"],
  });

  // Gauge for daily incentive rewards in USD.
  protected readonly incentiveByDateGauge = new Gauge({
    name: `${this.metricPrefix}_incentive_rewards_by_date`,
    help: "Daily incentive reward totals in USD",
    labelNames: ["date", "currency"],
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
    this.BGTContract = new this.web3.eth.Contract(
      require(`../abi/berachain/${this.BGTContractAddress}.json`),
      this.BGTContractAddress,
    );
    this.BGTStakerContract = new this.web3.eth.Contract(
      require(`../abi/berachain/${this.BGTStakerContractAddress}.json`),
      this.BGTStakerContractAddress,
    );

    this.registry.registerMetric(this.boostedGauge);
    this.registry.registerMetric(this.earnedHoneyGauge);
    this.registry.registerMetric(this.erc20BalanceGauge);
    this.registry.registerMetric(this.incentiveByDateGauge);
  }

  public override async start(): Promise<void> {
    if (!this.alchemyApiKey) {
      console.warn("ALCHEMY_API_KEY is not set; skipping ERC20 token discovery for Berachain");
      return;
    }

    await this.scanERC20Tokens();
    this.tokenScanTimer = setInterval(
      () => {
        void this.scanERC20Tokens();
      },
      60 * 60 * 1000,
    );
  }

  public override async stop(): Promise<void> {
    if (this.tokenScanTimer) {
      clearInterval(this.tokenScanTimer);
      this.tokenScanTimer = undefined;
    }
  }

  public async makeMetrics(): Promise<string> {
    // await super.makeMetrics();

    let customMetrics = "";
    try {
      await Promise.all([
        this.updateValidatorsPower(),
        this.updateEvmAddressBalance(this.addresses),
        this.updateBoosted(),
        this.fetchDailyIncentives(),
      ]);

      customMetrics = await this.registry.metrics();
    } catch (e) {
      console.error("makeMetrics", e);
    }

    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  // Periodically discover ERC20 tokens for configured addresses.
  private async scanERC20Tokens(): Promise<void> {
    if (!this.alchemyApiKey) {
      return;
    }

    const evmAddresses = this.addresses.split(",");

    try {
      for (const address of evmAddresses) {
        const response = await axios.post(`${this.alchemyApiUrl}${this.alchemyApiKey}`, {
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getTokenBalances",
          params: [address, "erc20"],
        });

        if (response.data && response.data.result && response.data.result.tokenBalances) {
          for (const token of response.data.result.tokenBalances) {
            const contractAddress = token.contractAddress;

            // Only fetch token metadata when it has not been cached yet.
            if (!this.erc20Metadata.has(contractAddress)) {
              await this.fetchTokenMetadata(contractAddress);
            }
          }
        }
      }

      console.log(`Scanned ERC20 tokens, found ${this.erc20Metadata.size} unique tokens`);
    } catch (e) {
      console.error("Error scanning ERC20 tokens:", e);
    }
  }

  // Fetch token metadata for a discovered contract address.
  private async fetchTokenMetadata(contractAddress: string): Promise<void> {
    if (this.erc20Metadata.has(contractAddress)) {
      return; // Skip requests for metadata that is already cached.
    }

    try {
      const metadataResponse = await axios.post(`${this.alchemyApiUrl}${this.alchemyApiKey}`, {
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getTokenMetadata",
        params: [contractAddress],
      });

      if (metadataResponse.data && metadataResponse.data.result) {
        const metadata = metadataResponse.data.result;
        this.erc20Metadata.set(contractAddress, {
          name: metadata.name || "Unknown",
          symbol: metadata.symbol || "UNKNOWN",
          decimals: metadata.decimals || 18,
        });
      }
    } catch (e) {
      console.error(`Error fetching metadata for token ${contractAddress}:`, e);
      // Fall back to default metadata when the upstream request fails.
      this.erc20Metadata.set(contractAddress, {
        name: "Unknown",
        symbol: "UNKNOWN",
        decimals: 18,
      });
    }
  }

  protected async updateBoosted(): Promise<void> {
    this.boostedGauge.reset();
    const boostees = await this.getBoostees(this.validator);
    this.boostedGauge.labels(this.validator, "BGT").set(boostees.amount);
  }

  protected async updateEvmAddressBalance(addresses: string): Promise<void> {
    this.earnedHoneyGauge.reset();
    this.erc20BalanceGauge.reset();

    const evmAddresses = addresses.split(",").filter((address) => address.startsWith("0x"));
    for (const address of evmAddresses) {
      // Fetch the native BERA balance.
      const bera = await this.getEVMAmount(address);
      this.availableGauge.labels(address, "BERA").set(bera.amount);

      // Fetch the BGT balance, which is not exposed as a generic ERC20 token here.
      const bgt = await this.getBGTAmount(address);
      this.availableGauge.labels(address, "BGT").set(bgt.amount);

      // Fetch cached ERC20 token balances.
      for (const [tokenAddress, metadata] of this.erc20Metadata.entries()) {
        try {
          const tokenContract = new this.web3.eth.Contract(
            require("../abi/erc20.json"),
            tokenAddress,
          );
          const balance: bigint = await tokenContract.methods.balanceOf(address).call();
          const amount = this.evmClient.scale(balance.toString(), metadata.decimals);

          this.erc20BalanceGauge
            .labels(address, tokenAddress, metadata.name, metadata.symbol)
            .set(amount);
        } catch (e) {
          console.error(`Error fetching balance for token ${tokenAddress} (${metadata.symbol})`, e);
        }
      }

      // Fetch Honey rewards earned through staking.
      const earnedHoney = await this.getBGTStakerEarnedAmount(address, this.decimalPlaces);
      this.earnedHoneyGauge.labels(address, "Honey").set(earnedHoney.amount);
    }
  }

  /**
   * Aggregate daily incentives in USD and publish them to the gauge.
   * Loads incentiveDistributionByValidators from Goldsky, resolves token prices from
   * the Berachain API, converts the token amounts to USD, and records daily totals.
   */
  private async fetchDailyIncentives(): Promise<void> {
    // Prepare validator public key and timestamp filters.
    const pubKey = this.validator;
    // Query the last 30 days using microsecond timestamps.
    const daysAgo = 30;
    const now = Math.floor(Date.now() / 1000);
    const fromTimestamp = (now - daysAgo * 24 * 60 * 60) * 1_000_000;
    // Goldsky GraphQL query.
    const goldskyUrl =
      "https://api.goldsky.com/api/public/project_clq1h5ct0g4a201x18tfte5iv/subgraphs/pol-subgraph/mainnet-latest/gn";
    const query = {
      operationName: "GetValidatorAnalytics",
      variables: {
        pubKey: pubKey,
        timestamp: fromTimestamp.toString(),
      },
      query: `query GetValidatorAnalytics($pubKey: Bytes!, $timestamp: Timestamp!) {\n  incentiveDistributionByValidators(\n    interval: day\n    where: {validator_: {publicKey: $pubKey}, timestamp_gte: $timestamp}\n  ) {\n    token {\n      address\n      symbol\n      decimals\n      name\n    }\n    receivedTokenAmount\n    timestamp\n    id\n    __typename\n  }\n}`,
    };
    let incentiveList: any[] = [];
    try {
      const res = await axios.post(goldskyUrl, query, {
        headers: { "content-type": "application/json" },
      });
      incentiveList = res.data?.data?.incentiveDistributionByValidators || [];
    } catch (e) {
      console.error("Goldsky incentiveDistributionByValidators error", e);
      return;
    }
    // Aggregate amounts by day and token.
    const dailyTokenMap: Record<string, Record<string, { amount: number; decimals: number }>> = {};
    for (const item of incentiveList) {
      const date = new Date(Number(item.timestamp) / 1000).toISOString().slice(0, 10); // YYYY-MM-DD
      const tokenAddr = item.token.address.toLowerCase();
      const decimals = item.token.decimals || 18;
      const amount = Number(item.receivedTokenAmount);
      if (!dailyTokenMap[date]) dailyTokenMap[date] = {};
      if (!dailyTokenMap[date][tokenAddr]) dailyTokenMap[date][tokenAddr] = { amount: 0, decimals };
      dailyTokenMap[date][tokenAddr].amount += amount;
    }
    // Fetch token prices from the Berachain API.
    const tokenAddresses = Array.from(
      new Set(Object.values(dailyTokenMap).flatMap((tokens) => Object.keys(tokens))),
    );
    const priceMap: Record<string, number> = {};
    if (tokenAddresses.length > 0) {
      const beraApiUrl = "https://api.berachain.com/";
      const priceQuery = {
        operationName: "GetTokenCurrentPrices",
        variables: {
          chains: ["BERACHAIN"],
          addressIn: tokenAddresses,
        },
        query: `query GetTokenCurrentPrices($chains: [GqlChain!]!, $addressIn: [String!]!) {\n  tokenGetCurrentPrices(chains: $chains, addressIn: $addressIn) {\n    address\n    price\n  }\n}`,
      };
      try {
        const priceRes = await axios.post(beraApiUrl, priceQuery, {
          headers: { "content-type": "application/json" },
        });
        const priceList = priceRes.data?.data?.tokenGetCurrentPrices || [];
        for (const p of priceList) {
          priceMap[p.address.toLowerCase()] = Number(p.price);
        }
      } catch (e) {
        console.error("Berachain price fetch error", e);
      }
    }
    // Convert each day to USD totals and record them in Prometheus.
    for (const date of Object.keys(dailyTokenMap)) {
      let usdSum = 0;
      for (const tokenAddr of Object.keys(dailyTokenMap[date])) {
        const { amount } = dailyTokenMap[date][tokenAddr];
        const price = priceMap[tokenAddr] || 0;
        usdSum += amount * price;
      }
      // Emit the Prometheus gauge using the day and USD currency label.
      this.incentiveByDateGauge.labels(date, "USD").set(usdSum);
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

  protected async getBGTStakerEarnedAmount(
    address: string,
    decimalPlaces: number,
  ): Promise<{
    amount: number;
  }> {
    try {
      const amount: bigint = await this.BGTStakerContract.methods.earned(address).call();
      return {
        amount: this.evmClient.scale(amount.toString(), decimalPlaces),
      };
    } catch (e) {
      console.error("getBGTStakerEarnedAmount");
      console.error(e);
      return {
        amount: 0,
      };
    }
  }

  protected async getBGTAmount(address: string): Promise<{
    amount: number;
  }> {
    try {
      const amount: bigint = await this.BGTContract.methods.balanceOf(address).call();
      return {
        amount: this.evmClient.scale(amount.toString(), this.decimalPlaces),
      };
    } catch (e) {
      console.error(e);
      return {
        amount: 0,
      };
    }
  }

  protected async getBoostees(address: string): Promise<{
    amount: number;
  }> {
    try {
      const amount: bigint = await this.BGTContract.methods.boostees(address).call();
      return {
        amount: this.evmClient.scale(amount.toString(), this.decimalPlaces),
      };
    } catch (e) {
      console.error(e);
      return {
        amount: 0,
      };
    }
  }
}
