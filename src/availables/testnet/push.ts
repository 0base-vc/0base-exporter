import { Gauge, Registry } from "prom-client";
import CosmosCollectorBase, { cosmosV1Profile } from "../shared/cosmos-base";

const PUSH_CHAIN_ID = "push_42101-1";
const HEALTH_TIMEOUT_MS = 4000;

interface PushStatus {
  height: number;
  catchingUp: boolean;
}

function rpcUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) {
    base.pathname += "/";
  }

  return new URL(path.replace(/^\/+/, ""), base).toString();
}

function nonNegativeInteger(value: unknown): number {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    throw new Error("invalid non-negative integer");
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("invalid non-negative integer");
  return parsed;
}

/** Push Chain Donut uses Cosmos v1 endpoints and 18-decimal upc amounts. */
export default class PushTestnet extends CosmosCollectorBase {
  protected readonly decimalPlaces = 18;
  private readonly healthRegistry = new Registry();
  private readonly localRpcUpGauge = new Gauge({
    name: "push_validator_local_rpc_up",
    help: "Whether the local Push Chain RPC is healthy.",
    registers: [this.healthRegistry],
  });
  private readonly referenceRpcUpGauge = new Gauge({
    name: "push_validator_reference_rpc_up",
    help: "Whether the Push Chain reference RPC is healthy.",
    registers: [this.healthRegistry],
  });
  private readonly catchingUpGauge = new Gauge({
    name: "push_validator_catching_up",
    help: "Whether the local Push Chain node is catching up.",
    registers: [this.healthRegistry],
  });
  private readonly localPeersGauge = new Gauge({
    name: "push_validator_local_peers",
    help: "Number of peers connected to the local Push Chain node.",
    registers: [this.healthRegistry],
  });
  private readonly localHeightGauge = new Gauge({
    name: "push_validator_local_height",
    help: "Latest block height reported by the local Push Chain node.",
    registers: [this.healthRegistry],
  });
  private readonly referenceHeightGauge = new Gauge({
    name: "push_validator_reference_height",
    help: "Latest block height reported by the Push Chain reference RPC.",
    registers: [this.healthRegistry],
  });
  private readonly appHashComparableGauge = new Gauge({
    name: "push_validator_app_hash_comparable",
    help: "Whether local and reference nodes report the same height for app hash comparison.",
    registers: [this.healthRegistry],
  });
  private readonly appHashMatchGauge = new Gauge({
    name: "push_validator_app_hash_match",
    help: "Whether local and reference app hashes match at the same height.",
    registers: [this.healthRegistry],
  });
  private readonly referenceRpcUrl: string;
  private pending?: Promise<string>;
  private baseMetricsPending?: Promise<string>;

  public constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly addresses: string,
    protected readonly validator: string,
    referenceRpcUrl = "",
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator, {
      ...cosmosV1Profile,
      unbondings: {
        ...cosmosV1Profile.unbondings,
        selector: (json) =>
          cosmosV1Profile.unbondings.selector(json).map((entry) => ({
            ...entry,
            denom: entry.denom ?? "upc",
          })),
      },
      rewards: {
        ...cosmosV1Profile.rewards,
        selector: (json) => json.total ?? [],
      },
    });
    this.referenceRpcUrl = referenceRpcUrl.trim();
  }

  public override async makeMetrics(): Promise<string> {
    if (!this.pending) {
      this.pending = this.collect().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  protected override get(
    url: string,
    process: (response: { data: any }) => any,
    timeoutMs = HEALTH_TIMEOUT_MS,
  ) {
    return super.get(url, process, timeoutMs);
  }

  private async collect(): Promise<string> {
    const baseMetrics = this.collectBaseMetrics();
    const healthMetrics = this.collectHealthMetrics();
    const [metrics, health] = await Promise.all([baseMetrics, healthMetrics]);
    return `${metrics}\n${health}`;
  }

  private async collectBaseMetrics(): Promise<string> {
    if (!this.baseMetricsPending) {
      const pending = super.makeMetrics().catch((error) => {
        console.error("Push base metrics", error);
        return "";
      });
      this.baseMetricsPending = pending.finally(() => {
        this.baseMetricsPending = undefined;
      });
    }

    return this.withTimeout(this.baseMetricsPending, HEALTH_TIMEOUT_MS, "");
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private resetHealthMetrics(): void {
    for (const metric of [
      this.localRpcUpGauge,
      this.referenceRpcUpGauge,
      this.catchingUpGauge,
      this.localPeersGauge,
      this.localHeightGauge,
      this.referenceHeightGauge,
      this.appHashComparableGauge,
      this.appHashMatchGauge,
    ]) {
      metric.reset();
    }
    this.healthRegistry.clear();
  }

  private enableHealthMetric(metric: Gauge): void {
    this.healthRegistry.registerMetric(metric);
  }

  private async readStatus(baseUrl: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<PushStatus> {
    return this.getFresh(
      rpcUrl(baseUrl, "/status"),
      (response) => {
        const result = response.data?.result;
        const network = result?.node_info?.network;
        const catchingUp = result?.sync_info?.catching_up;
        const height = nonNegativeInteger(result?.sync_info?.latest_block_height);
        if (network !== PUSH_CHAIN_ID || typeof catchingUp !== "boolean" || height <= 0) {
          throw new Error("invalid Push Chain status");
        }
        return { height, catchingUp };
      },
      timeoutMs,
    );
  }

  private async readPeers(timeoutMs = HEALTH_TIMEOUT_MS): Promise<number> {
    return this.getFresh(
      rpcUrl(this.rpcUrl, "/net_info"),
      (response) => {
        return nonNegativeInteger(response.data?.result?.n_peers);
      },
      timeoutMs,
    );
  }

  private async readAppHash(
    baseUrl: string,
    height: number,
    timeoutMs = HEALTH_TIMEOUT_MS,
  ): Promise<string> {
    return this.getFresh(
      rpcUrl(baseUrl, `/block?height=${height}`),
      (response) => {
        const appHash = response.data?.result?.block?.header?.app_hash;
        if (typeof appHash !== "string" || appHash.length === 0) {
          throw new Error("invalid Push Chain app hash");
        }
        return appHash;
      },
      timeoutMs,
    );
  }

  private async collectHealthMetrics(): Promise<string> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    const remainingTimeout = (): number => Math.max(1, deadline - Date.now());
    this.resetHealthMetrics();

    const localStatusRequest = this.readStatus(this.rpcUrl, remainingTimeout());
    const peersRequest = this.readPeers(remainingTimeout());
    const referenceStatusRequest = this.referenceRpcUrl
      ? this.readStatus(this.referenceRpcUrl, remainingTimeout())
      : Promise.resolve<PushStatus | undefined>(undefined);

    const [localStatusResult, peersResult, referenceStatusResult] = await Promise.allSettled([
      localStatusRequest,
      peersRequest,
      referenceStatusRequest,
    ]);

    const localStatus =
      localStatusResult.status === "fulfilled" ? localStatusResult.value : undefined;
    const peers = peersResult.status === "fulfilled" ? peersResult.value : undefined;
    const referenceStatus =
      referenceStatusResult.status === "fulfilled" ? referenceStatusResult.value : undefined;

    this.enableHealthMetric(this.localRpcUpGauge);
    this.localRpcUpGauge.set(Number(localStatus !== undefined));

    if (localStatus !== undefined) {
      this.enableHealthMetric(this.catchingUpGauge);
      this.catchingUpGauge.set(Number(localStatus.catchingUp));
      this.enableHealthMetric(this.localHeightGauge);
      this.localHeightGauge.set(localStatus.height);
    }

    if (peers !== undefined) {
      this.enableHealthMetric(this.localPeersGauge);
      this.localPeersGauge.set(peers);
    }

    if (this.referenceRpcUrl) {
      this.enableHealthMetric(this.referenceRpcUpGauge);
      this.referenceRpcUpGauge.set(Number(referenceStatus !== undefined));

      if (referenceStatus !== undefined) {
        this.enableHealthMetric(this.referenceHeightGauge);
        this.referenceHeightGauge.set(referenceStatus.height);
      }

      const comparable =
        localStatus !== undefined &&
        referenceStatus !== undefined &&
        localStatus.height === referenceStatus.height;
      this.enableHealthMetric(this.appHashComparableGauge);
      this.appHashComparableGauge.set(Number(comparable));

      if (comparable && deadline > Date.now()) {
        const [localAppHashResult, referenceAppHashResult] = await Promise.allSettled([
          this.readAppHash(this.rpcUrl, localStatus.height, remainingTimeout()),
          this.readAppHash(this.referenceRpcUrl, referenceStatus.height, remainingTimeout()),
        ]);

        if (
          localAppHashResult.status === "fulfilled" &&
          referenceAppHashResult.status === "fulfilled"
        ) {
          this.enableHealthMetric(this.appHashMatchGauge);
          this.appHashMatchGauge.set(
            Number(localAppHashResult.value === referenceAppHashResult.value),
          );
        }
      }
    }

    return await this.healthRegistry.metrics();
  }
}
