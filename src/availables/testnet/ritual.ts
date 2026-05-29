import type { Web3 } from "web3";
import { Gauge, Registry } from "prom-client";
import TargetAbstract from "../../target.abstract";
import EvmClient from "../../core/evm-client";
import { getDecimalPlaces, getEvmApiUrl, getOptionalEnv } from "../../core/runtime-env";

type JsonRpcError = string | { message?: string };

interface JsonRpcResponse<T> {
  result?: T;
  error?: JsonRpcError;
}

interface RitualValidator {
  node_pubkey?: string;
  consensus_pubkey?: string;
  status?: string;
  balance?: number | string;
  pending_withdrawal_amount?: number | string;
  has_pending_withdrawal?: boolean;
  joining_epoch?: number | string;
  withdrawal_credentials?: string;
  coinbase_address?: string;
  fee_recipient?: string;
  commission?: number | string;
  commission_rate?: number | string;
  commissionRate?: number | string;
}

interface RitualValidatorSet {
  count?: number;
  validators?: RitualValidator[];
}

interface SyncStatus {
  currentBlock?: string;
  highestBlock?: string;
}

const GWEI_PER_RIT = 1_000_000_000;
const DEFAULT_RPC_TIMEOUT_MS = 10000;
const DEFAULT_CACHE_MS = 30000;

function normalizeHex(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("0x")
    ? `0x${trimmed.slice(2).toLowerCase()}`
    : `0x${trimmed.toLowerCase()}`;
}

function normalizeCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

function withdrawalCredentialAddress(value: string | undefined): string {
  const normalized = normalizeHex(value);
  if (/^0x[0-9a-f]{64}$/.test(normalized)) {
    return `0x${normalized.slice(-40)}`;
  }

  return normalized;
}

function parseNumeric(value: number | string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseHexQuantity(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function gweiToRit(value: number | string | undefined): number | undefined {
  const parsed = parseNumeric(value);
  return parsed === undefined ? undefined : parsed / GWEI_PER_RIT;
}

function validatorFeeRecipient(validator: RitualValidator): string {
  return validator.fee_recipient || validator.coinbase_address || "";
}

function validatorCommissionRate(validator: RitualValidator): number | undefined {
  return parseNumeric(
    validator.commission_rate ?? validator.commissionRate ?? validator.commission,
  );
}

function labelValue(value: string | undefined): string {
  return value?.trim() || "unknown";
}

export default class Ritual extends TargetAbstract {
  public readonly web3: Web3;
  private readonly evmClient: EvmClient;
  private readonly metricPrefix = "ritual";
  private readonly registry = new Registry();
  private readonly decimalPlaces = getDecimalPlaces(18);
  private readonly elRpcUrl = getEvmApiUrl();
  private readonly clRpcUrl =
    getOptionalEnv("RITUAL_CL_RPC_URL") ||
    this.apiUrl ||
    (getOptionalEnv("RPC_URL") ? this.rpcUrl : "");
  private readonly rpcTimeoutMs =
    parseNumeric(getOptionalEnv("RITUAL_RPC_TIMEOUT_MS")) ?? DEFAULT_RPC_TIMEOUT_MS;
  private readonly cacheMs = parseNumeric(getOptionalEnv("RITUAL_CACHE_MS")) ?? DEFAULT_CACHE_MS;

  private readonly addressAvailableGauge = new Gauge({
    name: `${this.metricPrefix}_address_available`,
    help: "Available native RIT balance of address",
    labelNames: ["address", "denom"],
  });
  private readonly executionLayerUpGauge = new Gauge({
    name: `${this.metricPrefix}_execution_layer_up`,
    help: "Whether the Ritual execution-layer JSON-RPC endpoint is reachable",
  });
  private readonly executionLayerChainIdGauge = new Gauge({
    name: `${this.metricPrefix}_execution_layer_chain_id`,
    help: "Ritual execution-layer chain ID",
  });
  private readonly executionLayerBlockGauge = new Gauge({
    name: `${this.metricPrefix}_execution_layer_latest_block`,
    help: "Latest execution-layer block observed through JSON-RPC",
  });
  private readonly executionLayerPeerGauge = new Gauge({
    name: `${this.metricPrefix}_execution_layer_peer_count`,
    help: "Execution-layer peer count",
  });
  private readonly executionLayerSyncingGauge = new Gauge({
    name: `${this.metricPrefix}_execution_layer_syncing`,
    help: "Whether the execution layer reports that it is syncing",
  });
  private readonly executionLayerSyncBlockGauge = new Gauge({
    name: `${this.metricPrefix}_execution_layer_sync_block`,
    help: "Execution-layer sync progress blocks when eth_syncing returns an object",
    labelNames: ["kind"],
  });
  private readonly consensusLayerUpGauge = new Gauge({
    name: `${this.metricPrefix}_consensus_layer_up`,
    help: "Whether the Ritual consensus-layer JSON-RPC endpoint is reachable",
  });
  private readonly consensusLayerHealthGauge = new Gauge({
    name: `${this.metricPrefix}_consensus_layer_health`,
    help: "Consensus-layer health status as reported by Ritual CL RPC",
    labelNames: ["status"],
  });
  private readonly consensusLayerHeightGauge = new Gauge({
    name: `${this.metricPrefix}_consensus_layer_latest_height`,
    help: "Latest consensus-layer height",
  });
  private readonly consensusLayerEpochGauge = new Gauge({
    name: `${this.metricPrefix}_consensus_layer_latest_epoch`,
    help: "Latest consensus-layer epoch",
  });
  private readonly validatorCountGauge = new Gauge({
    name: `${this.metricPrefix}_validator_count`,
    help: "Ritual validator counts",
    labelNames: ["set"],
  });
  private readonly validatorsStakeGauge = new Gauge({
    name: `${this.metricPrefix}_validators_stake`,
    help: "Stake of validators in the Ritual validator set",
    labelNames: ["node_pubkey", "status", "denom"],
  });
  private readonly validatorInfoGauge = new Gauge({
    name: `${this.metricPrefix}_validator_info`,
    help: "Configured Ritual validator information",
    labelNames: [
      "node_pubkey",
      "consensus_pubkey",
      "status",
      "withdrawal_address",
      "fee_recipient",
      "coinbase_address",
    ],
  });
  private readonly validatorObservedGauge = new Gauge({
    name: `${this.metricPrefix}_validator_observed`,
    help: "Whether a configured Ritual validator selector was found in the validator set",
    labelNames: ["selector"],
  });
  private readonly validatorStakeGauge = new Gauge({
    name: `${this.metricPrefix}_validator_stake`,
    help: "Stake of configured Ritual validator",
    labelNames: ["node_pubkey", "withdrawal_address", "fee_recipient", "denom"],
  });
  private readonly validatorPendingWithdrawalGauge = new Gauge({
    name: `${this.metricPrefix}_validator_pending_withdrawal`,
    help: "Pending withdrawal amount of configured Ritual validator",
    labelNames: ["node_pubkey", "withdrawal_address", "denom"],
  });
  private readonly validatorPendingWithdrawalActiveGauge = new Gauge({
    name: `${this.metricPrefix}_validator_pending_withdrawal_active`,
    help: "Whether configured Ritual validator has a pending withdrawal",
    labelNames: ["node_pubkey"],
  });
  private readonly validatorJoiningEpochGauge = new Gauge({
    name: `${this.metricPrefix}_validator_joining_epoch`,
    help: "Joining epoch of configured Ritual validator",
    labelNames: ["node_pubkey"],
  });
  private readonly validatorRankGauge = new Gauge({
    name: `${this.metricPrefix}_validator_rank`,
    help: "Rank of configured Ritual validator by stake in getAllValidators",
    labelNames: ["node_pubkey"],
  });
  private readonly validatorCommissionAvailableGauge = new Gauge({
    name: `${this.metricPrefix}_validator_commission_available`,
    help: "Whether Ritual RPC exposed a commission field for the configured validator",
    labelNames: ["node_pubkey"],
  });
  private readonly validatorCommissionRateGauge = new Gauge({
    name: `${this.metricPrefix}_validator_commission_rate`,
    help: "Commission rate of configured Ritual validator when exposed by Ritual RPC",
    labelNames: ["node_pubkey"],
  });

  public constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly addresses: string,
    protected readonly validator: string,
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator);

    this.evmClient = new EvmClient(this.elRpcUrl);
    this.web3 = this.evmClient.web3;

    [
      this.addressAvailableGauge,
      this.executionLayerUpGauge,
      this.executionLayerChainIdGauge,
      this.executionLayerBlockGauge,
      this.executionLayerPeerGauge,
      this.executionLayerSyncingGauge,
      this.executionLayerSyncBlockGauge,
      this.consensusLayerUpGauge,
      this.consensusLayerHealthGauge,
      this.consensusLayerHeightGauge,
      this.consensusLayerEpochGauge,
      this.validatorCountGauge,
      this.validatorsStakeGauge,
      this.validatorInfoGauge,
      this.validatorObservedGauge,
      this.validatorStakeGauge,
      this.validatorPendingWithdrawalGauge,
      this.validatorPendingWithdrawalActiveGauge,
      this.validatorJoiningEpochGauge,
      this.validatorRankGauge,
      this.validatorCommissionAvailableGauge,
      this.validatorCommissionRateGauge,
    ].forEach((metric) => this.registry.registerMetric(metric));
  }

  public async makeMetrics(): Promise<string> {
    try {
      this.resetDynamicGauges();
      await Promise.all([
        this.updateExecutionLayerMetrics(),
        this.updateConsensusLayerMetrics(),
        this.updateAddressBalances(),
      ]);
    } catch (error) {
      console.error("ritual makeMetrics", error);
    }

    return (await this.registry.metrics()) + "\n" + (await this.loadExistMetrics());
  }

  private resetDynamicGauges(): void {
    [
      this.addressAvailableGauge,
      this.executionLayerSyncBlockGauge,
      this.consensusLayerHealthGauge,
      this.validatorCountGauge,
      this.validatorsStakeGauge,
      this.validatorInfoGauge,
      this.validatorObservedGauge,
      this.validatorStakeGauge,
      this.validatorPendingWithdrawalGauge,
      this.validatorPendingWithdrawalActiveGauge,
      this.validatorJoiningEpochGauge,
      this.validatorRankGauge,
      this.validatorCommissionAvailableGauge,
      this.validatorCommissionRateGauge,
    ].forEach((metric) => metric.reset());
  }

  private async updateAddressBalances(): Promise<void> {
    for (const address of normalizeCsv(this.addresses).filter(isEvmAddress)) {
      try {
        const balance = await this.evmClient.getNativeBalance(address, this.decimalPlaces);
        this.addressAvailableGauge.labels(address, "RIT").set(balance);
      } catch (error) {
        console.error(`ritual address balance failed for ${address}`, error);
      }
    }
  }

  private async updateExecutionLayerMetrics(): Promise<void> {
    const chainId = await this.rpcCall<string>(this.elRpcUrl, "eth_chainId");
    if (!chainId) {
      this.executionLayerUpGauge.set(0);
      return;
    }

    this.executionLayerUpGauge.set(1);
    const parsedChainId = parseHexQuantity(chainId);
    if (parsedChainId !== undefined) {
      this.executionLayerChainIdGauge.set(parsedChainId);
    }

    const [blockNumber, peerCount, syncing] = await Promise.all([
      this.rpcCall<string>(this.elRpcUrl, "eth_blockNumber"),
      this.rpcCall<string>(this.elRpcUrl, "net_peerCount"),
      this.rpcCall<boolean | SyncStatus>(this.elRpcUrl, "eth_syncing"),
    ]);

    const parsedBlock = parseHexQuantity(blockNumber);
    if (parsedBlock !== undefined) {
      this.executionLayerBlockGauge.set(parsedBlock);
    }

    const parsedPeers = parseHexQuantity(peerCount);
    if (parsedPeers !== undefined) {
      this.executionLayerPeerGauge.set(parsedPeers);
    }

    if (typeof syncing === "boolean") {
      this.executionLayerSyncingGauge.set(syncing ? 1 : 0);
    } else if (syncing) {
      this.executionLayerSyncingGauge.set(1);
      const currentBlock = parseHexQuantity(syncing.currentBlock);
      const highestBlock = parseHexQuantity(syncing.highestBlock);
      if (currentBlock !== undefined) {
        this.executionLayerSyncBlockGauge.labels("current").set(currentBlock);
      }
      if (highestBlock !== undefined) {
        this.executionLayerSyncBlockGauge.labels("highest").set(highestBlock);
      }
    }
  }

  private async updateConsensusLayerMetrics(): Promise<void> {
    if (!this.clRpcUrl) {
      this.consensusLayerUpGauge.set(0);
      return;
    }

    const health = await this.rpcCall<string>(this.clRpcUrl, "health");
    if (!health) {
      this.consensusLayerUpGauge.set(0);
      return;
    }

    this.consensusLayerUpGauge.set(1);
    this.consensusLayerHealthGauge.labels(health).set(1);

    const [latestHeight, latestEpoch, allValidators, activeValidators] = await Promise.all([
      this.rpcCall<number>(this.clRpcUrl, "getLatestHeight"),
      this.rpcCall<number>(this.clRpcUrl, "getLatestEpoch"),
      this.rpcCall<RitualValidatorSet>(this.clRpcUrl, "getAllValidators"),
      this.rpcCall<RitualValidatorSet>(this.clRpcUrl, "getActiveValidators"),
    ]);

    if (latestHeight !== undefined) {
      this.consensusLayerHeightGauge.set(latestHeight);
    }
    if (latestEpoch !== undefined) {
      this.consensusLayerEpochGauge.set(latestEpoch);
    }

    const validators = allValidators?.validators ?? [];
    this.validatorCountGauge.labels("all").set(allValidators?.count ?? validators.length);
    this.validatorCountGauge
      .labels("active")
      .set(activeValidators?.count ?? activeValidators?.validators?.length ?? 0);

    validators.forEach((entry) => {
      const nodePubkey = normalizeHex(entry.node_pubkey);
      const stake = gweiToRit(entry.balance);
      if (nodePubkey && stake !== undefined) {
        this.validatorsStakeGauge.labels(nodePubkey, labelValue(entry.status), "RIT").set(stake);
      }
    });

    this.updateConfiguredValidatorMetrics(validators);
  }

  private updateConfiguredValidatorMetrics(validators: RitualValidator[]): void {
    const selectors = [...normalizeCsv(this.validator), ...normalizeCsv(this.addresses)];
    const uniqueSelectors = [...new Set(selectors)];
    const sortedValidators = [...validators].sort(
      (left, right) => (parseNumeric(right.balance) ?? 0) - (parseNumeric(left.balance) ?? 0),
    );
    const matched = validators.filter((entry) => this.matchesConfiguredSelector(entry));

    uniqueSelectors.forEach((selector) => {
      this.validatorObservedGauge
        .labels(selector)
        .set(matched.some((entry) => this.matchesSelector(entry, selector)) ? 1 : 0);
    });

    matched.forEach((entry) => {
      const nodePubkey = normalizeHex(entry.node_pubkey);
      const consensusPubkey = normalizeHex(entry.consensus_pubkey);
      const withdrawalAddress = withdrawalCredentialAddress(entry.withdrawal_credentials);
      const feeRecipient = validatorFeeRecipient(entry);
      const coinbaseAddress = entry.coinbase_address || "";
      const stake = gweiToRit(entry.balance);
      const pendingWithdrawal = gweiToRit(entry.pending_withdrawal_amount);
      const joiningEpoch = parseNumeric(entry.joining_epoch);
      const commissionRate = validatorCommissionRate(entry);
      const rank =
        sortedValidators.findIndex(
          (candidate) => normalizeHex(candidate.node_pubkey) === nodePubkey,
        ) + 1;

      this.validatorInfoGauge
        .labels(
          labelValue(nodePubkey),
          labelValue(consensusPubkey),
          labelValue(entry.status),
          labelValue(withdrawalAddress),
          labelValue(feeRecipient),
          labelValue(coinbaseAddress),
        )
        .set(1);

      if (stake !== undefined) {
        this.validatorStakeGauge
          .labels(
            labelValue(nodePubkey),
            labelValue(withdrawalAddress),
            labelValue(feeRecipient),
            "RIT",
          )
          .set(stake);
      }
      if (pendingWithdrawal !== undefined) {
        this.validatorPendingWithdrawalGauge
          .labels(labelValue(nodePubkey), labelValue(withdrawalAddress), "RIT")
          .set(pendingWithdrawal);
      }

      this.validatorPendingWithdrawalActiveGauge
        .labels(labelValue(nodePubkey))
        .set(entry.has_pending_withdrawal ? 1 : 0);

      if (joiningEpoch !== undefined) {
        this.validatorJoiningEpochGauge.labels(labelValue(nodePubkey)).set(joiningEpoch);
      }
      if (rank > 0) {
        this.validatorRankGauge.labels(labelValue(nodePubkey)).set(rank);
      }

      this.validatorCommissionAvailableGauge
        .labels(labelValue(nodePubkey))
        .set(commissionRate === undefined ? 0 : 1);
      if (commissionRate !== undefined) {
        this.validatorCommissionRateGauge.labels(labelValue(nodePubkey)).set(commissionRate);
      }
    });
  }

  private matchesConfiguredSelector(validator: RitualValidator): boolean {
    const selectors = [...normalizeCsv(this.validator), ...normalizeCsv(this.addresses)];
    return selectors.some((selector) => this.matchesSelector(validator, selector));
  }

  private matchesSelector(validator: RitualValidator, selector: string): boolean {
    const normalizedSelector = normalizeHex(selector);
    const candidates = [
      validator.node_pubkey,
      validator.consensus_pubkey,
      withdrawalCredentialAddress(validator.withdrawal_credentials),
      validator.fee_recipient,
      validator.coinbase_address,
    ].map(normalizeHex);

    return candidates.includes(normalizedSelector);
  }

  private async rpcCall<T>(
    url: string,
    method: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    if (!url) {
      return undefined;
    }

    const result = await this.postWithCache(
      url,
      { method, params },
      (response) => {
        const data = response.data as JsonRpcResponse<T>;
        if (data.error) {
          const message = typeof data.error === "string" ? data.error : data.error.message;
          throw new Error(`${method} failed: ${message ?? "unknown JSON-RPC error"}`);
        }

        return data.result;
      },
      this.cacheMs,
      this.rpcTimeoutMs,
    );

    return result === "" ? undefined : result;
  }
}
