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
    total?: number | string;
    validators?: GnolandValidator[];
  };
}

interface GnolandBlockId {
  hash?: string;
  parts?: {
    total?: number | string;
    hash?: string;
  };
}

interface GnolandPrecommit {
  validator_address?: string;
  block_id?: GnolandBlockId;
}

interface GnolandCommitResponse {
  result?: {
    signed_header?: {
      header?: {
        height?: number | string;
        proposer_address?: string;
        validators_hash?: string;
      };
      commit?: {
        block_id?: GnolandBlockId;
        precommits?: Array<GnolandPrecommit | null>;
      };
    };
  };
}

interface GnolandBalanceResponse {
  result?: {
    response?: {
      ResponseBase?: {
        Error?: unknown;
        Data?: string;
      };
    };
  };
}

interface RankedValidator {
  address: string;
  pubKeyType: string;
  pubKeyValue: string;
  votingPower: number;
}

interface SigningCommit {
  height: number;
  proposerAddress: string;
  validatorsHash: string;
  precommitAddresses: string[];
}

interface SigningRow {
  height: number;
  active: boolean;
  signed: boolean;
  proposed: boolean;
}

interface CoinBalance {
  amount: number;
  denom: string;
}

const CACHE_DURATION_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;
const SIGNING_LOOKBACK_BLOCKS = 100;
const SIGNING_REFRESH_MS = 15000;
const SIGNING_CONCURRENCY = 8;
const VALIDATOR_SET_CACHE_SIZE = 16;
const DEFAULT_DENOM = "ugnot";

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

function blockIdsMatch(left: GnolandBlockId | undefined, right: GnolandBlockId): boolean {
  const leftHash = normalizeLabel(left?.hash);
  const rightHash = normalizeLabel(right.hash);

  return (
    leftHash.length > 0 &&
    leftHash === rightHash &&
    parseNumber(left?.parts?.total) === parseNumber(right.parts?.total) &&
    normalizeLabel(left?.parts?.hash) === normalizeLabel(right.parts?.hash)
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function decodeBase64String(value: string): string {
  if (!value) {
    return "";
  }

  const decoded = Buffer.from(value, "base64").toString("utf8");
  try {
    const parsed = JSON.parse(decoded) as unknown;
    return typeof parsed === "string" ? parsed : String(parsed ?? "");
  } catch {
    return decoded.replace(/^"|"$/g, "");
  }
}

function parseCoins(value: string): CoinBalance[] {
  const coins: CoinBalance[] = [];
  const matcher = /(\d+)\s*([a-zA-Z][a-zA-Z0-9/]*)/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(value)) !== null) {
    coins.push({ amount: parseNumber(match[1]), denom: match[2] });
  }

  return coins;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export default class GnolandTestnet extends TargetAbstract {
  private readonly metricPrefix = "gnoland";
  private readonly registry = new Registry();
  private readonly signingWindow: SigningRow[] = [];
  private readonly validatorSetCache = new Map<string, Set<string>>();
  private signingLastObservedHeight = 0;
  private signingLastUpdatedSeconds = 0;
  private signingRefreshPromise?: Promise<void>;
  private signingRefreshTimer?: NodeJS.Timeout;

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

  private readonly walletQueryUpGauge = new Gauge({
    name: `${this.metricPrefix}_wallet_query_up`,
    help: "Whether the Gno.land operator wallet balance query succeeded",
    labelNames: ["address"],
  });

  private readonly addressAvailableGauge = new Gauge({
    name: `${this.metricPrefix}_address_available`,
    help: "Available balance of the configured Gno.land operator address",
    labelNames: ["address", "denom"],
  });

  private readonly validatorCommissionAvailableGauge = new Gauge({
    name: `${this.metricPrefix}_validator_commission_available`,
    help: "Whether Gno.land exposes a commission field for the configured validator",
    labelNames: ["validator"],
  });

  private readonly signingTrackerUpGauge = new Gauge({
    name: `${this.metricPrefix}_validator_signing_tracker_up`,
    help: "Whether recent Gno.land validator signatures can be read from RPC",
    labelNames: ["validator"],
  });

  private readonly signingWindowBlocksGauge = new Gauge({
    name: `${this.metricPrefix}_validator_signing_window_blocks`,
    help: "Number of eligible blocks in the rolling Gno.land validator signing window",
    labelNames: ["validator"],
  });

  private readonly signedBlocksGauge = new Gauge({
    name: `${this.metricPrefix}_validator_signed_blocks`,
    help: "Number of signed blocks in the rolling Gno.land validator signing window",
    labelNames: ["validator"],
  });

  private readonly missedBlocksGauge = new Gauge({
    name: `${this.metricPrefix}_validator_missed_blocks`,
    help: "Number of missed blocks in the rolling Gno.land validator signing window",
    labelNames: ["validator"],
  });

  private readonly missRateGauge = new Gauge({
    name: `${this.metricPrefix}_validator_miss_rate`,
    help: "Missed block ratio in the rolling Gno.land validator signing window",
    labelNames: ["validator"],
  });

  private readonly consecutiveMissedBlocksGauge = new Gauge({
    name: `${this.metricPrefix}_validator_consecutive_missed_blocks`,
    help: "Current consecutive missed Gno.land validator block count",
    labelNames: ["validator"],
  });

  private readonly lastSignedHeightGauge = new Gauge({
    name: `${this.metricPrefix}_validator_last_signed_height`,
    help: "Last block height signed by the configured Gno.land validator",
    labelNames: ["validator"],
  });

  private readonly lastMissedHeightGauge = new Gauge({
    name: `${this.metricPrefix}_validator_last_missed_height`,
    help: "Last block height missed by the configured Gno.land validator",
    labelNames: ["validator"],
  });

  private readonly proposedBlocksGauge = new Gauge({
    name: `${this.metricPrefix}_validator_proposed_blocks`,
    help: "Number of proposed blocks in the rolling Gno.land validator signing window",
    labelNames: ["validator"],
  });

  private readonly signedLatestGauge = new Gauge({
    name: `${this.metricPrefix}_validator_signed_latest`,
    help: "Whether the latest eligible block was signed by the configured Gno.land validator",
    labelNames: ["validator"],
  });

  private readonly signingLastObservedHeightGauge = new Gauge({
    name: `${this.metricPrefix}_validator_signing_last_observed_height`,
    help: "Last block height inspected by the Gno.land validator signing tracker",
    labelNames: ["validator"],
  });

  private readonly signingLastUpdatedGauge = new Gauge({
    name: `${this.metricPrefix}_validator_signing_last_updated_seconds`,
    help: "Unix timestamp of the last successful Gno.land validator signing tracker update",
    labelNames: ["validator"],
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
    this.registry.registerMetric(this.walletQueryUpGauge);
    this.registry.registerMetric(this.addressAvailableGauge);
    this.registry.registerMetric(this.validatorCommissionAvailableGauge);
    this.registry.registerMetric(this.signingTrackerUpGauge);
    this.registry.registerMetric(this.signingWindowBlocksGauge);
    this.registry.registerMetric(this.signedBlocksGauge);
    this.registry.registerMetric(this.missedBlocksGauge);
    this.registry.registerMetric(this.missRateGauge);
    this.registry.registerMetric(this.consecutiveMissedBlocksGauge);
    this.registry.registerMetric(this.lastSignedHeightGauge);
    this.registry.registerMetric(this.lastMissedHeightGauge);
    this.registry.registerMetric(this.proposedBlocksGauge);
    this.registry.registerMetric(this.signedLatestGauge);
    this.registry.registerMetric(this.signingLastObservedHeightGauge);
    this.registry.registerMetric(this.signingLastUpdatedGauge);

    this.updateSigningGauges(0);
  }

  public async start(): Promise<void> {
    if (!this.configuredValidator()) {
      return;
    }

    void this.refreshSigningMetrics();
    this.signingRefreshTimer = setInterval(
      () => void this.refreshSigningMetrics(),
      SIGNING_REFRESH_MS,
    );
    this.signingRefreshTimer.unref();
  }

  public async stop(): Promise<void> {
    if (this.signingRefreshTimer) {
      clearInterval(this.signingRefreshTimer);
      this.signingRefreshTimer = undefined;
    }

    await this.signingRefreshPromise;
  }

  public async makeMetrics(): Promise<string> {
    await Promise.all([this.updateRpcMetricsSafely(), this.updateWalletMetrics()]);
    const customMetrics = await this.registry.metrics();
    return customMetrics + "\n" + (await this.loadExistMetrics());
  }

  private async updateRpcMetricsSafely(): Promise<void> {
    try {
      await this.updateRpcMetrics();
      this.rpcUpGauge.set(1);
    } catch (error) {
      console.error("Gnoland RPC metrics failed", error);
      this.rpcUpGauge.set(0);
    }
  }

  private async updateRpcMetrics(): Promise<void> {
    const [status, netInfo, validatorsResponse] = await Promise.all([
      this.fetchStatus(),
      this.fetchNetInfo(),
      this.fetchValidators(),
    ]);

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
    const configuredValidator = this.configuredValidator();
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

  private async updateWalletMetrics(): Promise<void> {
    const addresses = splitCsv(this.addresses);
    const validator = this.configuredValidator();

    this.walletQueryUpGauge.reset();
    this.addressAvailableGauge.reset();
    this.validatorCommissionAvailableGauge.reset();

    await Promise.all(
      addresses.map(async (address) => {
        try {
          const coins = await this.fetchBalance(address);
          const balances = coins.length > 0 ? coins : [{ amount: 0, denom: DEFAULT_DENOM }];

          this.walletQueryUpGauge.labels(address).set(1);
          for (const balance of balances) {
            this.addressAvailableGauge.labels(address, balance.denom).set(balance.amount);
          }
        } catch (error) {
          console.error(`Gnoland wallet balance query failed for ${address}`, error);
          this.walletQueryUpGauge.labels(address).set(0);
          this.addressAvailableGauge.labels(address, DEFAULT_DENOM).set(0);
        }
      }),
    );

    if (validator) {
      this.validatorCommissionAvailableGauge.labels(validator).set(0);
    }
  }

  private async refreshSigningMetrics(): Promise<void> {
    if (!this.configuredValidator()) {
      return;
    }

    if (this.signingRefreshPromise) {
      return this.signingRefreshPromise;
    }

    const refresh = this.collectSigningMetrics()
      .then(() => {
        this.signingLastUpdatedSeconds = Math.floor(Date.now() / 1000);
        this.updateSigningGauges(1);
      })
      .catch((error: unknown) => {
        console.error("Gnoland validator signing tracker failed", error);
        this.updateSigningGauges(0);
      })
      .finally(() => {
        this.signingRefreshPromise = undefined;
      });

    this.signingRefreshPromise = refresh;
    return refresh;
  }

  private async collectSigningMetrics(): Promise<void> {
    const status = await this.fetchStatus();
    const latestHeight = parseNumber(status.result?.sync_info?.latest_block_height);

    if (!Number.isSafeInteger(latestHeight) || latestHeight < 1) {
      throw new Error("Latest Gno.land block height is unavailable");
    }

    let startHeight = this.signingLastObservedHeight + 1;
    if (
      this.signingLastObservedHeight === 0 ||
      latestHeight < this.signingLastObservedHeight ||
      latestHeight - this.signingLastObservedHeight >= SIGNING_LOOKBACK_BLOCKS
    ) {
      startHeight = Math.max(1, latestHeight - SIGNING_LOOKBACK_BLOCKS + 1);
    }

    if (startHeight > latestHeight) {
      return;
    }

    const heights = Array.from(
      { length: latestHeight - startHeight + 1 },
      (_, index) => startHeight + index,
    );
    const commits = await mapLimit(heights, SIGNING_CONCURRENCY, (height) =>
      this.fetchCommit(height),
    );
    const validatorSetHeights = new Map<string, number>();

    for (const commit of commits) {
      if (!validatorSetHeights.has(commit.validatorsHash)) {
        validatorSetHeights.set(commit.validatorsHash, commit.height);
      }
    }

    const validatorSets = new Map<string, Set<string>>();
    await Promise.all(
      [...validatorSetHeights].map(async ([hash, height]) => {
        validatorSets.set(hash, await this.getValidatorSet(hash, height));
      }),
    );

    const validator = normalizeAddress(this.configuredValidator());
    const rows = commits.map((commit) => ({
      height: commit.height,
      active: validatorSets.get(commit.validatorsHash)?.has(validator) ?? false,
      signed: commit.precommitAddresses.includes(validator),
      proposed: normalizeAddress(commit.proposerAddress) === validator,
    }));

    const retainedRows = this.signingWindow.filter((row) => row.height < startHeight);
    this.signingWindow.splice(
      0,
      this.signingWindow.length,
      ...[...retainedRows, ...rows].slice(-SIGNING_LOOKBACK_BLOCKS),
    );
    this.signingLastObservedHeight = latestHeight;
  }

  private updateSigningGauges(trackerUp: number): void {
    const validator = this.configuredValidator();
    if (!validator) {
      return;
    }

    const eligibleRows = this.signingWindow.filter((row) => row.active);
    const signedRows = eligibleRows.filter((row) => row.signed);
    const missedRows = eligibleRows.filter((row) => !row.signed);
    const latestRow = eligibleRows[eligibleRows.length - 1];
    let consecutiveMisses = 0;

    for (let index = eligibleRows.length - 1; index >= 0; index -= 1) {
      if (eligibleRows[index].signed) {
        break;
      }
      consecutiveMisses += 1;
    }

    this.signingTrackerUpGauge.labels(validator).set(trackerUp);
    this.signingWindowBlocksGauge.labels(validator).set(eligibleRows.length);
    this.signedBlocksGauge.labels(validator).set(signedRows.length);
    this.missedBlocksGauge.labels(validator).set(missedRows.length);
    this.missRateGauge
      .labels(validator)
      .set(eligibleRows.length > 0 ? missedRows.length / eligibleRows.length : 0);
    this.consecutiveMissedBlocksGauge.labels(validator).set(consecutiveMisses);
    this.lastSignedHeightGauge
      .labels(validator)
      .set(signedRows[signedRows.length - 1]?.height ?? 0);
    this.lastMissedHeightGauge
      .labels(validator)
      .set(missedRows[missedRows.length - 1]?.height ?? 0);
    this.proposedBlocksGauge
      .labels(validator)
      .set(eligibleRows.filter((row) => row.proposed).length);
    this.signedLatestGauge.labels(validator).set(latestRow?.signed ? 1 : 0);
    this.signingLastObservedHeightGauge.labels(validator).set(this.signingLastObservedHeight);
    this.signingLastUpdatedGauge.labels(validator).set(this.signingLastUpdatedSeconds);
  }

  private async getValidatorSet(hash: string, height: number): Promise<Set<string>> {
    const cached = this.validatorSetCache.get(hash);
    if (cached) {
      this.validatorSetCache.delete(hash);
      this.validatorSetCache.set(hash, cached);
      return cached;
    }

    const addresses = await this.fetchValidatorSet(height);
    this.validatorSetCache.set(hash, addresses);

    while (this.validatorSetCache.size > VALIDATOR_SET_CACHE_SIZE) {
      const oldestKey = this.validatorSetCache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.validatorSetCache.delete(oldestKey);
    }

    return addresses;
  }

  private async fetchValidatorSet(height: number): Promise<Set<string>> {
    const addresses = new Set<string>();

    for (let page = 1; page <= 100; page += 1) {
      const response = await this.fetchValidatorPage(height, page);
      const validators = response.result?.validators ?? [];
      const total = parseNumber(response.result?.total) || validators.length;

      for (const entry of validators) {
        const address = normalizeAddress(entry.address);
        if (address) {
          addresses.add(address);
        }
      }

      if (validators.length === 0 || addresses.size >= total) {
        break;
      }
    }

    return addresses;
  }

  private async fetchStatus(): Promise<GnolandStatusResponse> {
    const response = await this.getWithCache(
      this.rpcEndpoint("/status"),
      (rpcResponse) => rpcResponse.data as GnolandStatusResponse,
      CACHE_DURATION_MS,
      REQUEST_TIMEOUT_MS,
    );

    if (typeof response !== "object" || response === null || !response.result) {
      throw new Error("Invalid Gno.land status response");
    }
    return response;
  }

  private async fetchNetInfo(): Promise<GnolandNetInfoResponse> {
    const response = await this.getWithCache(
      this.rpcEndpoint("/net_info"),
      (rpcResponse) => rpcResponse.data as GnolandNetInfoResponse,
      CACHE_DURATION_MS,
      REQUEST_TIMEOUT_MS,
    );

    if (typeof response !== "object" || response === null || !response.result) {
      throw new Error("Invalid Gno.land net_info response");
    }
    return response;
  }

  private async fetchValidators(): Promise<GnolandValidatorsResponse> {
    const response = await this.getWithCache(
      this.rpcEndpoint("/validators"),
      (rpcResponse) => rpcResponse.data as GnolandValidatorsResponse,
      CACHE_DURATION_MS,
      REQUEST_TIMEOUT_MS,
    );

    if (typeof response !== "object" || response === null || !response.result) {
      throw new Error("Invalid Gno.land validators response");
    }
    return response;
  }

  private async fetchCommit(height: number): Promise<SigningCommit> {
    const response = await this.get(
      this.rpcEndpoint(`/commit?height=${height}`),
      (rpcResponse) => rpcResponse.data as GnolandCommitResponse,
      REQUEST_TIMEOUT_MS,
    );
    const signedHeader = typeof response === "object" ? response.result?.signed_header : undefined;
    const heightValue = parseNumber(signedHeader?.header?.height);
    const validatorsHash = normalizeLabel(signedHeader?.header?.validators_hash);
    const committedBlockId = signedHeader?.commit?.block_id;

    if (
      !signedHeader?.header ||
      !signedHeader.commit ||
      !heightValue ||
      !validatorsHash ||
      !normalizeLabel(committedBlockId?.hash)
    ) {
      throw new Error(`Gno.land commit ${height} is unavailable`);
    }

    return {
      height: heightValue,
      proposerAddress: normalizeAddress(signedHeader.header.proposer_address),
      validatorsHash,
      precommitAddresses: (signedHeader.commit.precommits ?? [])
        .filter((vote: GnolandPrecommit | null) => blockIdsMatch(vote?.block_id, committedBlockId))
        .map((vote: GnolandPrecommit | null) => normalizeAddress(vote?.validator_address))
        .filter(Boolean),
    };
  }

  private async fetchValidatorPage(
    height: number,
    page: number,
  ): Promise<GnolandValidatorsResponse> {
    const response = await this.get(
      this.rpcEndpoint(`/validators?height=${height}&page=${page}&per_page=100`),
      (rpcResponse) => rpcResponse.data as GnolandValidatorsResponse,
      REQUEST_TIMEOUT_MS,
    );

    if (typeof response !== "object" || response === null || !response.result) {
      throw new Error(`Invalid Gno.land validator set response at height ${height}`);
    }
    return response;
  }

  private async fetchBalance(address: string): Promise<CoinBalance[]> {
    const path = encodeURIComponent(`bank/balances/${address}`);
    const response = await this.getWithCache(
      this.rpcEndpoint(`/abci_query?path=${path}`),
      (rpcResponse) => rpcResponse.data as GnolandBalanceResponse,
      CACHE_DURATION_MS,
      REQUEST_TIMEOUT_MS,
    );
    const responseBase =
      typeof response === "object" ? response.result?.response?.ResponseBase : null;

    if (!responseBase) {
      throw new Error(`Invalid Gno.land balance response for ${address}`);
    }
    if (responseBase.Error !== undefined && responseBase.Error !== null) {
      throw new Error(`Gno.land balance query failed for ${address}`);
    }

    return parseCoins(decodeBase64String(responseBase.Data ?? ""));
  }

  private configuredValidator(): string {
    return normalizeLabel(splitCsv(this.validator)[0]);
  }

  private rpcEndpoint(path: string): string {
    const baseUrl = (this.rpcUrl || this.apiUrl).replace(/\/+$/, "");
    return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }
}
