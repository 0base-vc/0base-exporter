import { Gauge, Registry } from "prom-client";
import TargetAbstract from "../../target.abstract";

interface GnolandStatusResponse {
  result?: {
    node_info?: {
      moniker?: string;
      network?: string;
      version?: string;
    };
    sync_info?: {
      catching_up?: boolean | string;
      latest_block_height?: number | string;
      latest_block_time?: string;
    };
  };
}

interface GnolandNetInfoResponse {
  result?: {
    n_peers?: number | string;
    listening?: boolean | string;
  };
}

interface GnolandValidator {
  address?: string;
  pub_key?: {
    "@type"?: string;
    value?: string;
  };
  voting_power?: number | string;
  proposer_priority?: number | string;
}

interface GnolandValidatorsResponse {
  result?: {
    block_height?: number | string;
    validators?: GnolandValidator[];
  };
}

interface RankedValidator {
  address: string;
  pubKeyType: string;
  pubKeyValue: string;
  votingPower: number;
}

const CACHE_DURATION_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

function parseNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }

  return false;
}

function normalizeLabel(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeAddress(value: unknown): string {
  return normalizeLabel(value).toLowerCase();
}

export default class GnolandTestnet extends TargetAbstract {
  private readonly metricPrefix = "gnoland";
  private readonly registry = new Registry();

  private readonly rpcUpGauge = new Gauge({
    name: `${this.metricPrefix}_rpc_up`,
    help: "Whether the Gno.land RPC endpoints are usable, including cached fallback data",
  });

  private readonly networkInfoGauge = new Gauge({
    name: `${this.metricPrefix}_network_info`,
    help: "Gno.land network metadata",
    labelNames: ["network", "moniker", "version"],
  });

  private readonly latestBlockHeightGauge = new Gauge({
    name: `${this.metricPrefix}_latest_block_height`,
    help: "Latest block height reported by the Gno.land RPC status endpoint",
  });

  private readonly latestBlockTimeGauge = new Gauge({
    name: `${this.metricPrefix}_latest_block_time_seconds`,
    help: "Latest block time reported by the Gno.land RPC status endpoint as Unix seconds",
  });

  private readonly catchingUpGauge = new Gauge({
    name: `${this.metricPrefix}_catching_up`,
    help: "Whether the Gno.land node reports that it is catching up",
  });

  private readonly peerCountGauge = new Gauge({
    name: `${this.metricPrefix}_peer_count`,
    help: "Number of peers reported by the Gno.land RPC net_info endpoint",
  });

  private readonly listeningGauge = new Gauge({
    name: `${this.metricPrefix}_listening`,
    help: "Whether the Gno.land RPC net_info endpoint reports listener status",
  });

  private readonly validatorSetBlockHeightGauge = new Gauge({
    name: `${this.metricPrefix}_validator_set_block_height`,
    help: "Block height of the validator set returned by the Gno.land RPC validators endpoint",
  });

  private readonly activeValidatorsGauge = new Gauge({
    name: `${this.metricPrefix}_active_validators`,
    help: "Number of validators with non-zero voting power",
  });

  private readonly validatorPowerGauge = new Gauge({
    name: `${this.metricPrefix}_validator_voting_power`,
    help: "Voting power of the configured Gno.land validator",
    labelNames: ["validator"],
  });

  private readonly validatorActiveGauge = new Gauge({
    name: `${this.metricPrefix}_validator_active`,
    help: "Whether the configured Gno.land validator is in the active validator set",
    labelNames: ["validator"],
  });

  private readonly validatorRankGauge = new Gauge({
    name: `${this.metricPrefix}_validator_rank`,
    help: "Rank of the configured Gno.land validator by voting power",
    labelNames: ["validator"],
  });

  private readonly rivalsPowerGauge = new Gauge({
    name: `${this.metricPrefix}_validator_power_rivals`,
    help: "Voting power of neighboring Gno.land validators by rank",
    labelNames: ["rank"],
  });

  private readonly validatorsPowerGauge = new Gauge({
    name: `${this.metricPrefix}_validators_power`,
    help: "Voting power of each Gno.land validator",
    labelNames: ["address"],
  });

  private readonly validatorInfoGauge = new Gauge({
    name: `${this.metricPrefix}_validator_info`,
    help: "Public metadata for each Gno.land validator",
    labelNames: ["address", "pub_key_type", "pub_key"],
  });

  public constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly addresses: string,
    protected readonly validator: string,
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator);

    this.registry.registerMetric(this.rpcUpGauge);
    this.registry.registerMetric(this.networkInfoGauge);
    this.registry.registerMetric(this.latestBlockHeightGauge);
    this.registry.registerMetric(this.latestBlockTimeGauge);
    this.registry.registerMetric(this.catchingUpGauge);
    this.registry.registerMetric(this.peerCountGauge);
    this.registry.registerMetric(this.listeningGauge);
    this.registry.registerMetric(this.validatorSetBlockHeightGauge);
    this.registry.registerMetric(this.activeValidatorsGauge);
    this.registry.registerMetric(this.validatorPowerGauge);
    this.registry.registerMetric(this.validatorActiveGauge);
    this.registry.registerMetric(this.validatorRankGauge);
    this.registry.registerMetric(this.rivalsPowerGauge);
    this.registry.registerMetric(this.validatorsPowerGauge);
    this.registry.registerMetric(this.validatorInfoGauge);
  }

  public async makeMetrics(): Promise<string> {
    let customMetrics = "";

    try {
      await this.updateRpcMetrics();
      customMetrics = await this.registry.metrics();
    } catch (error) {
      console.error("makeMetrics", error);
      this.rpcUpGauge.set(0);
      customMetrics = await this.registry.metrics();
    }

    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  private async updateRpcMetrics(): Promise<void> {
    const [status, netInfo, validatorsResponse] = await Promise.all([
      this.fetchStatus(),
      this.fetchNetInfo(),
      this.fetchValidators(),
    ]);

    this.rpcUpGauge.set(1);
    this.updateStatusMetrics(status);
    this.updateNetInfoMetrics(netInfo);
    this.updateValidatorMetrics(validatorsResponse);
  }

  private updateStatusMetrics(status: GnolandStatusResponse): void {
    const nodeInfo = status.result?.node_info;
    const syncInfo = status.result?.sync_info;
    const blockTime = Date.parse(syncInfo?.latest_block_time ?? "");

    this.networkInfoGauge.reset();
    this.networkInfoGauge
      .labels(
        normalizeLabel(nodeInfo?.network),
        normalizeLabel(nodeInfo?.moniker),
        normalizeLabel(nodeInfo?.version),
      )
      .set(1);
    this.latestBlockHeightGauge.set(parseNumber(syncInfo?.latest_block_height));
    this.latestBlockTimeGauge.set(Number.isFinite(blockTime) ? Math.floor(blockTime / 1000) : 0);
    this.catchingUpGauge.set(parseBoolean(syncInfo?.catching_up) ? 1 : 0);
  }

  private updateNetInfoMetrics(netInfo: GnolandNetInfoResponse): void {
    this.peerCountGauge.set(parseNumber(netInfo.result?.n_peers));
    this.listeningGauge.set(parseBoolean(netInfo.result?.listening) ? 1 : 0);
  }

  private updateValidatorMetrics(validatorsResponse: GnolandValidatorsResponse): void {
    const validators = this.normalizeValidators(validatorsResponse.result?.validators ?? []);
    const sorted = [...validators].sort((a, b) => b.votingPower - a.votingPower);
    const configuredValidator = normalizeLabel(this.validator.split(",")[0]);
    const configuredValidatorAddress = normalizeAddress(configuredValidator);
    const validatorIndex = sorted.findIndex(
      (entry) => normalizeAddress(entry.address) === configuredValidatorAddress,
    );
    const ownValidator = validatorIndex >= 0 ? sorted[validatorIndex] : undefined;
    const rank = validatorIndex >= 0 ? validatorIndex + 1 : 0;
    const aboveValidator = validatorIndex > 0 ? sorted[validatorIndex - 1] : ownValidator;
    const belowValidator = validatorIndex >= 0 ? sorted[validatorIndex + 1] : undefined;

    this.validatorsPowerGauge.reset();
    this.validatorInfoGauge.reset();

    for (const entry of sorted) {
      this.validatorsPowerGauge.labels(entry.address).set(entry.votingPower);
      this.validatorInfoGauge.labels(entry.address, entry.pubKeyType, entry.pubKeyValue).set(1);
    }

    this.validatorSetBlockHeightGauge.set(parseNumber(validatorsResponse.result?.block_height));
    this.activeValidatorsGauge.set(sorted.filter((entry) => entry.votingPower > 0).length);
    this.validatorPowerGauge.labels(configuredValidator).set(ownValidator?.votingPower ?? 0);
    this.validatorActiveGauge
      .labels(configuredValidator)
      .set((ownValidator?.votingPower ?? 0) > 0 ? 1 : 0);
    this.validatorRankGauge.labels(configuredValidator).set(rank);
    this.rivalsPowerGauge.labels("above").set(aboveValidator?.votingPower ?? 0);
    this.rivalsPowerGauge.labels("below").set(belowValidator?.votingPower ?? 0);
  }

  private normalizeValidators(validators: GnolandValidator[]): RankedValidator[] {
    return validators
      .map((entry) => ({
        address: normalizeLabel(entry.address),
        pubKeyType: normalizeLabel(entry.pub_key?.["@type"]),
        pubKeyValue: normalizeLabel(entry.pub_key?.value),
        votingPower: parseNumber(entry.voting_power),
      }))
      .filter((entry) => entry.address.length > 0);
  }

  private async fetchStatus(): Promise<GnolandStatusResponse> {
    return this.getWithCache(
      this.rpcEndpoint("/status"),
      (response) => response.data as GnolandStatusResponse,
      CACHE_DURATION_MS,
      REQUEST_TIMEOUT_MS,
    );
  }

  private async fetchNetInfo(): Promise<GnolandNetInfoResponse> {
    return this.getWithCache(
      this.rpcEndpoint("/net_info"),
      (response) => response.data as GnolandNetInfoResponse,
      CACHE_DURATION_MS,
      REQUEST_TIMEOUT_MS,
    );
  }

  private async fetchValidators(): Promise<GnolandValidatorsResponse> {
    return this.getWithCache(
      this.rpcEndpoint("/validators"),
      (response) => response.data as GnolandValidatorsResponse,
      CACHE_DURATION_MS,
      REQUEST_TIMEOUT_MS,
    );
  }

  private rpcEndpoint(path: string): string {
    const baseUrl = (this.rpcUrl || this.apiUrl).replace(/\/+$/, "");
    return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }
}
