import { Gauge } from "prom-client";
import CosmosCollectorBase, { cosmosV1beta1Profile } from "../shared/cosmos-base";
import CachedHttpClient from "../../core/http/cached-http-client";

/** Limonata uses standard Cosmos REST balances/staking, with 18-decimal aLIMO. */
export default class Limonata extends CosmosCollectorBase {
  protected readonly decimalPlaces = 18;
  private readonly fresh = new CachedHttpClient();
  private pending?: Promise<string>;
  private deadline = 0;

  constructor(
    existMetrics: string,
    apiUrl: string,
    rpcUrl: string,
    addresses: string,
    validator: string,
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator, {
      ...cosmosV1beta1Profile,
      rewards: { ...cosmosV1beta1Profile.rewards, selector: (json) => json.total ?? [] },
      proposals: {
        url: (url) => `${url}/cosmos/gov/v1/proposals?proposal_status=2`,
        selector: (json) => json.proposals.length,
      },
    });
  }

  // Health and balances must not silently replay a previous successful response.
  protected async get(url: string, process: (response: { data: any }) => any): Promise<any> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new Error("Limonata collection deadline exceeded");
    return this.fresh.getFresh(url, process, remaining);
  }

  protected getAmount(
    url: string,
    selector: (json: any) => Array<{ denom?: string; amount: number | string }>,
    decimal: number,
  ): Promise<Array<{ denom: string; amount: number }>> {
    return super.getAmount(
      url,
      (json) =>
        selector(json)
          .filter((coin) => coin.denom === "aLIMO" || coin.denom === undefined)
          // Cosmos unbonding entries omit denom; the chain's bond denom is aLIMO.
          .map((coin) => ({ ...coin, denom: "aLIMO" })),
      decimal,
    );
  }

  public makeMetrics(): Promise<string> {
    if (!this.pending)
      this.pending = this.collect().finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async collect(): Promise<string> {
    this.deadline = Date.now() + 4000;
    // Keep one registry, including when performance instrumentation is enabled.
    for (const metric of this.registry.getMetricsAsArray()) {
      if (metric.name.startsWith("limonata_")) this.registry.removeSingleMetric(metric.name);
    }
    this.registry.resetMetrics();
    const gauge = (name: string, help: string, value: number) => {
      if (!Number.isFinite(value)) throw new Error(`Invalid ${name}`);
      new Gauge({ name: `limonata_${name}`, help, registers: [this.registry] }).set(value);
    };
    const health = async (name: string, work: () => Promise<void>) => {
      try {
        await work();
        gauge(name, `Whether ${name} data was collected this scrape`, 1);
      } catch {
        gauge(name, `Whether ${name} data was collected this scrape`, 0);
      }
    };
    let native = "";
    await Promise.all([
      ...(this.existMetrics
        ? [
            health("native_metrics_up", async () => {
              const urls = this.existMetrics
                .split(",")
                .map((url) => url.trim())
                .filter(Boolean);
              const results = await Promise.allSettled(
                urls.map((url) =>
                  this.get(url, ({ data }) => String(data).replace(/cometbft/g, "tendermint")),
                ),
              );
              native = results
                .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
                .join("\n");
              if (results.some((result) => result.status === "rejected"))
                throw new Error("Incomplete native scrape");
            }),
          ]
        : []),
      health("cosmos_up", async () => {
        // Wait for every task even when one fails, so no late writes leak into the next scrape.
        const results = await Promise.allSettled([
          this.updateAddressBalance(this.addresses),
          this.updateRank(this.validator),
          this.updateMaxValidator(),
          this.updateProposalsCount(),
        ]);
        if (results.some((r) => r.status === "rejected"))
          throw new Error("Incomplete Cosmos scrape");
      }),
      health("rpc_up", async () => {
        await this.get(`${this.rpcUrl}/status`, ({ data }) => {
          const r = data.result;
          if (
            r.node_info.network !== "limonata_10777-1" ||
            typeof r.sync_info.catching_up !== "boolean"
          )
            throw new Error("Wrong network or invalid status");
          gauge(
            "latest_block_height",
            "Local CometBFT height",
            Number(r.sync_info.latest_block_height),
          );
          gauge(
            "latest_block_time_seconds",
            "Timestamp of the latest committed block",
            Date.parse(r.sync_info.latest_block_time) / 1000,
          );
          gauge("catching_up", "CometBFT catching_up flag", Number(r.sync_info.catching_up));
          gauge(
            "voting_power",
            "Local validator consensus voting power",
            Number(r.validator_info.voting_power),
          );
        });
      }),
      health("peers_up", async () => {
        await this.get(`${this.rpcUrl}/net_info`, ({ data }) => {
          gauge("peers", "Connected CometBFT peers", Number(data.result.n_peers));
        });
      }),
      health("validator_query_up", async () => {
        await this.get(
          `${this.apiUrl}/cosmos/staking/v1beta1/validators/${this.validator}`,
          ({ data }) => {
            const v = data.validator;
            if (
              typeof v.jailed !== "boolean" ||
              !["BOND_STATUS_BONDED", "BOND_STATUS_UNBONDED", "BOND_STATUS_UNBONDING"].includes(
                v.status,
              )
            )
              throw new Error("Invalid validator");
            gauge(
              "validator_bonded",
              "Whether the operator is bonded",
              Number(v.status === "BOND_STATUS_BONDED"),
            );
            gauge("validator_jailed", "Whether the operator is jailed", Number(v.jailed));
            gauge("validator_tokens", "Validator bonded tokens in LIMO", Number(v.tokens) / 1e18);
          },
        );
      }),
    ]);
    return (await this.registry.metrics()) + "\n" + native;
  }
}
