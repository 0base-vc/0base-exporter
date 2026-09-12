import TargetAbstract from "../../target.abstract";
import { Gauge, Registry } from "prom-client";

type RpcResult = unknown;

type ClusterNode = {
  pubkey?: string;
  gossip?: string | null;
  shredVersion?: number;
};

type VoteAccount = {
  votePubkey?: string;
  nodePubkey?: string;
  activatedStake?: number;
  commission?: number;
  lastVote?: number;
  epochCredits?: unknown;
};

type VoteAccounts = {
  current?: VoteAccount[];
  delinquent?: VoteAccount[];
};

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * SphereNet's public testnet speaks the standard Solana JSON-RPC surface, but
 * it is a separate permissioned cluster. This collector deliberately uses
 * only the cluster RPC: it does not query Solana mainnet indexers or infer
 * admission from an absent vote account.
 */
export default class SphereNet extends TargetAbstract {
  private readonly registry = new Registry();

  private readonly rpcUpGauge = new Gauge({
    name: "spherenet_rpc_up",
    help: "Whether the SphereNet JSON-RPC health check succeeded",
  });

  private readonly slotGauge = new Gauge({
    name: "spherenet_slot",
    help: "Latest observed SphereNet slot",
  });

  private readonly epochGauge = new Gauge({
    name: "spherenet_epoch",
    help: "Current SphereNet epoch",
  });

  private readonly peerCountGauge = new Gauge({
    name: "spherenet_peer_count",
    help: "Number of nodes returned by getClusterNodes",
  });

  private readonly validatorCountGauge = new Gauge({
    name: "spherenet_validator_count",
    help: "Number of current and delinquent vote accounts returned by getVoteAccounts",
  });

  private readonly voteAccountsUpGauge = new Gauge({
    name: "spherenet_vote_accounts_up",
    help: "Whether the getVoteAccounts request succeeded",
  });

  private readonly validatorActiveGauge = new Gauge({
    name: "spherenet_validator_active",
    help: "Whether the configured vote account is in the current validator set",
    labelNames: ["vote"],
  });

  private readonly activatedStakeGauge = new Gauge({
    name: "spherenet_validator_activated_stake_sphr",
    help: "Activated stake for the configured vote account in SPHR",
    labelNames: ["vote"],
  });

  private readonly commissionGauge = new Gauge({
    name: "spherenet_validator_commission_percent",
    help: "Commission percentage for the configured vote account",
    labelNames: ["vote"],
  });

  private readonly lastVoteGauge = new Gauge({
    name: "spherenet_validator_last_vote",
    help: "Last vote slot for the configured vote account",
    labelNames: ["vote"],
  });

  private readonly identityGauge = new Gauge({
    name: "spherenet_identity_info",
    help: "Identity returned by getIdentity (value is always 1)",
    labelNames: ["identity"],
  });

  private readonly versionGauge = new Gauge({
    name: "spherenet_version_info",
    help: "SphereNet client version returned by getVersion (value is always 1)",
    labelNames: ["solana_core", "sphere_version", "feature_set"],
  });

  private readonly genesisMatchGauge = new Gauge({
    name: "spherenet_genesis_match",
    help: "Whether getGenesisHash matches the configured expected genesis hash",
  });

  private readonly shredVersionGauge = new Gauge({
    name: "spherenet_shred_version",
    help: "Shred version observed from the first cluster node",
  });

  private readonly shredVersionMatchGauge = new Gauge({
    name: "spherenet_shred_version_match",
    help: "Whether the observed shred version matches the configured expected value",
  });

  private readonly expectedGenesisHash: string;
  private readonly expectedShredVersion: number | null;

  public constructor(
    protected readonly existMetrics: string,
    protected readonly apiUrl: string,
    protected readonly rpcUrl: string,
    protected readonly votes: string,
    protected readonly identities: string,
    expectedGenesisHash = "",
    expectedShredVersion = "",
  ) {
    super(existMetrics, apiUrl, rpcUrl, votes, identities);
    this.expectedGenesisHash = expectedGenesisHash.trim();
    this.expectedShredVersion = expectedShredVersion.trim()
      ? finiteNumber(expectedShredVersion)
      : null;

    this.registry.registerMetric(this.rpcUpGauge);
    this.registry.registerMetric(this.slotGauge);
    this.registry.registerMetric(this.epochGauge);
    this.registry.registerMetric(this.peerCountGauge);
    this.registry.registerMetric(this.validatorCountGauge);
    this.registry.registerMetric(this.voteAccountsUpGauge);
    this.registry.registerMetric(this.validatorActiveGauge);
    this.registry.registerMetric(this.activatedStakeGauge);
    this.registry.registerMetric(this.commissionGauge);
    this.registry.registerMetric(this.lastVoteGauge);
    this.registry.registerMetric(this.identityGauge);
    this.registry.registerMetric(this.versionGauge);
    this.registry.registerMetric(this.genesisMatchGauge);
    this.registry.registerMetric(this.shredVersionGauge);
    this.registry.registerMetric(this.shredVersionMatchGauge);
  }

  public async makeMetrics(): Promise<string> {
    this.resetMetrics();

    const [health, slot, epoch, identity, version, genesis, clusterNodes, voteAccounts] =
      await Promise.all(
        [
          this.rpc("getHealth"),
          this.rpc("getSlot"),
          this.rpc("getEpochInfo"),
          this.rpc("getIdentity"),
          this.rpc("getVersion"),
          this.rpc("getGenesisHash"),
          this.rpc("getClusterNodes"),
          this.rpc("getVoteAccounts"),
        ].map((request) => this.settle(request)),
      );

    if (health.ok && health.value === "ok") {
      this.rpcUpGauge.set(1);
    } else {
      this.rpcUpGauge.set(0);
    }

    if (slot.ok) {
      this.setNumber(this.slotGauge, slot.value);
    }
    if (epoch.ok && epoch.value && typeof epoch.value === "object") {
      this.setNumber(this.epochGauge, (epoch.value as { epoch?: unknown }).epoch);
    }
    if (identity.ok && identity.value && typeof identity.value === "object") {
      const identityValue = stringValue((identity.value as { identity?: unknown }).identity);
      if (identityValue) this.identityGauge.labels(identityValue).set(1);
    }
    if (version.ok && version.value && typeof version.value === "object") {
      const value = version.value as {
        "solana-core"?: unknown;
        snVersion?: unknown;
        "feature-set"?: unknown;
      };
      const solanaCore = stringValue(value["solana-core"]);
      const sphereVersion = stringValue(value.snVersion);
      const featureSet = String(value["feature-set"] ?? "");
      if (solanaCore || sphereVersion || featureSet) {
        this.versionGauge.labels(solanaCore, sphereVersion, featureSet).set(1);
      }
    }
    if (genesis.ok) {
      const genesisHash = stringValue(genesis.value);
      if (this.expectedGenesisHash && genesisHash) {
        this.genesisMatchGauge.set(genesisHash === this.expectedGenesisHash ? 1 : 0);
      }
    }
    if (clusterNodes.ok && Array.isArray(clusterNodes.value)) {
      this.peerCountGauge.set(clusterNodes.value.length);
      const firstNode = (clusterNodes.value as ClusterNode[]).find(
        (node) => finiteNumber(node.shredVersion) !== null,
      );
      const shredVersion = finiteNumber(firstNode?.shredVersion);
      if (shredVersion !== null) {
        this.shredVersionGauge.set(shredVersion);
        if (this.expectedShredVersion !== null) {
          this.shredVersionMatchGauge.set(shredVersion === this.expectedShredVersion ? 1 : 0);
        }
      }
    }
    if (voteAccounts.ok && voteAccounts.value && typeof voteAccounts.value === "object") {
      this.voteAccountsUpGauge.set(1);
      this.setVoteAccounts(voteAccounts.value as VoteAccounts);
    } else {
      this.voteAccountsUpGauge.set(0);
    }

    return `${await this.registry.metrics()}\n${await this.loadExistMetrics()}`;
  }

  private resetMetrics(): void {
    this.rpcUpGauge.reset();
    this.slotGauge.reset();
    this.epochGauge.reset();
    this.peerCountGauge.reset();
    this.validatorCountGauge.reset();
    this.voteAccountsUpGauge.reset();
    this.validatorActiveGauge.reset();
    this.activatedStakeGauge.reset();
    this.commissionGauge.reset();
    this.lastVoteGauge.reset();
    this.identityGauge.reset();
    this.versionGauge.reset();
    this.genesisMatchGauge.reset();
    this.shredVersionGauge.reset();
    this.shredVersionMatchGauge.reset();
  }

  private async rpc(method: string): Promise<RpcResult> {
    return this.postFresh(
      this.rpcUrl,
      { method },
      (response) => {
        const body = response.data as { error?: unknown; result?: unknown };
        if (body?.error) throw new Error(`SphereNet RPC ${method} failed`);
        return body?.result;
      },
      4000,
    );
  }

  private async settle(
    request: Promise<RpcResult>,
  ): Promise<{ ok: true; value: RpcResult } | { ok: false; value?: undefined }> {
    try {
      return { ok: true, value: await request };
    } catch {
      return { ok: false };
    }
  }

  private setNumber(gauge: Gauge<string>, value: unknown): void {
    const parsed = finiteNumber(value);
    if (parsed !== null) gauge.set(parsed);
  }

  private setVoteAccounts(value: VoteAccounts): void {
    const current = Array.isArray(value.current) ? value.current : [];
    const delinquent = Array.isArray(value.delinquent) ? value.delinquent : [];
    const all = [...current, ...delinquent];
    this.validatorCountGauge.set(all.length);

    const currentVotes = new Set(
      current.map((account) => stringValue(account.votePubkey)).filter(Boolean),
    );
    for (const vote of this.votes
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      const account = all.find((item) => item.votePubkey === vote);
      if (!account) continue;
      this.validatorActiveGauge.labels(vote).set(currentVotes.has(vote) ? 1 : 0);
      const stake = finiteNumber(account.activatedStake);
      if (stake !== null) this.activatedStakeGauge.labels(vote).set(stake / 1e9);
      const commission = finiteNumber(account.commission);
      if (commission !== null) this.commissionGauge.labels(vote).set(commission);
      const lastVote = finiteNumber(account.lastVote);
      if (lastVote !== null) this.lastVoteGauge.labels(vote).set(lastVote);
    }
  }
}
