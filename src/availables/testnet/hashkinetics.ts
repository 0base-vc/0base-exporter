import { Gauge, Registry } from "prom-client";
import TargetAbstract from "../../target.abstract";
import CachedHttpClient from "../../core/http/cached-http-client";

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an RPC object");
  }
  return value as ObjectValue;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Expected a non-negative RPC number");
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("Expected RPC text");
  return value;
}

function chain(value: ObjectValue): ObjectValue {
  number(value.height);
  number(value.peers);
  text(value.chain_id);
  text(value.genesis_digest);
  text(value.app_hash);
  text(value.node_version);
  return value;
}

/** HashKinetics v0.19+ read-only RPC collector. Never reads validator key files. */
export default class Hashkinetics extends TargetAbstract {
  private readonly transport = new CachedHttpClient();
  private pending?: Promise<string>;
  private lastHeight?: number;
  private progressAt?: number;

  constructor(
    existMetrics: string,
    apiUrl: string,
    rpcUrl: string,
    addresses: string,
    validator: string,
  ) {
    super(existMetrics, apiUrl, rpcUrl, addresses, validator.trim().toLowerCase());
    // The root identity survives operational-key rotations; the consensus address does not.
    if (this.validator && !/^[0-9a-f]{96}$/.test(this.validator)) {
      throw new Error("Hashkinetics VALIDATOR must be the 96-character public root_pk hex");
    }
  }

  public makeMetrics(): Promise<string> {
    if (!this.pending) {
      this.pending = this.collect().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  private rpc(url: string, method: string, params: ObjectValue = {}): Promise<ObjectValue> {
    // No stale-cache fallback: availability gauges must describe this scrape.
    return this.transport.postFresh(
      url,
      { method, params },
      ({ data }: { data: unknown }) => {
        const response = object(data);
        if (response.error) throw new Error("Hashkinetics RPC error");
        return object(response.result);
      },
      4000,
    );
  }

  private async collect(): Promise<string> {
    // A scrape-local registry prevents old values surviving RPC failures or set changes.
    const registry = new Registry();
    const gauge = (
      name: string,
      help: string,
      value: number,
      labels: Record<string, string> = {},
    ) => {
      new Gauge({
        name: `hashkinetics_${name}`,
        help,
        labelNames: Object.keys(labels),
        registers: [registry],
      }).set(labels, value);
    };
    const [localResult, validatorResult, referenceResult] = await Promise.allSettled([
      this.rpc(this.rpcUrl, "hk_chainInfo").then(chain),
      this.rpc(this.rpcUrl, "hk_getValidators"),
      this.apiUrl ? this.rpc(this.apiUrl, "hk_chainInfo").then(chain) : Promise.resolve(undefined),
    ]);
    gauge(
      "rpc_up",
      "Whether local hk_chainInfo succeeded in this scrape",
      Number(localResult.status === "fulfilled"),
    );
    const local = localResult.status === "fulfilled" ? localResult.value : undefined;
    if (local) {
      const height = number(local.height);
      if (this.lastHeight !== height) {
        this.lastHeight = height;
        this.progressAt = Date.now() / 1000;
      }
      gauge("network_info", "Local node network and software version", 1, {
        chain_id: text(local.chain_id),
        version: text(local.node_version),
      });
      gauge("latest_block_height", "Local verified chain height", height);
      gauge("peer_count", "Connected consensus peers", number(local.peers));
      gauge(
        "last_progress_time_seconds",
        "Exporter observation time of the last height change; resets on exporter restart, not chain block time",
        this.progressAt!,
      );
      const process =
        local.process && typeof local.process === "object" && !Array.isArray(local.process)
          ? object(local.process)
          : undefined;
      if (process) {
        for (const [key, metric, help] of [
          ["rss_bytes", "node_rss_bytes", "Node resident memory in bytes"],
          ["uptime_secs", "node_uptime_seconds", "Node process uptime in seconds"],
          [
            "verifier_init_ms",
            "verifier_init_milliseconds",
            "STARK verifier startup duration in milliseconds",
          ],
        ]) {
          if (
            typeof process[key] === "number" &&
            Number.isFinite(process[key]) &&
            Number(process[key]) >= 0
          )
            gauge(metric, help, Number(process[key]));
        }
      }
      // Optional fields may be unavailable on other versions; never invent a zero.
      try {
        const signer = object(local.signer);
        const remaining = number(signer.remaining),
          capacity = number(signer.capacity),
          epoch = number(signer.epoch);
        if (capacity <= 0 || remaining > capacity) throw new Error("Invalid signer capacity");
        gauge(
          "signer_remaining",
          "Unused one-time consensus signatures in the current operational key",
          remaining,
        );
        gauge("signer_capacity", "Total one-time signature capacity per operational key", capacity);
        gauge(
          "signer_remaining_ratio",
          "Fraction of one-time signatures remaining; rotation is expected below 20 percent",
          remaining / capacity,
        );
        gauge("signer_epoch", "Local operational signing-key epoch", epoch);
      } catch {
        /* Unavailable signer data is omitted. */
      }
    }

    try {
      if (validatorResult.status !== "fulfilled") throw new Error("Validator query failed");
      const set = validatorResult.value;
      if (!Array.isArray(set.validators)) throw new Error("Missing validator set");
      const validators = set.validators.map((entry) => {
        const v = object(entry);
        return {
          root: text(v.root_pk).toLowerCase(),
          power: number(v.voting_power),
          epoch: number(v.epoch),
        };
      });
      // Validate the complete response before publishing any set-derived samples.
      const total = number(set.total_power),
        quorum = number(set.quorum_power);
      gauge("validator_query_up", "Whether the local validator set query succeeded", 1);
      gauge(
        "active_validators",
        "Validators with positive power in the local node's set",
        validators.filter((v) => v.power > 0).length,
      );
      gauge("total_voting_power", "Total power of the local validator set", total);
      gauge("quorum_power", "Voting power needed for consensus", quorum);
      if (this.validator) {
        const ours = validators.find((v) => v.root === this.validator);
        gauge(
          "validator_active",
          "Whether the configured public root is active in the LOCAL validator set; consult catching_up before admission decisions",
          Number(!!ours && ours.power > 0),
        );
        gauge(
          "validator_voting_power",
          "Voting power of the configured public root in the local set",
          ours?.power ?? 0,
        );
        if (ours)
          gauge(
            "validator_epoch",
            "Configured validator operational-key epoch recorded in the local set",
            ours.epoch,
          );
      }
    } catch {
      gauge("validator_query_up", "Whether the local validator set query succeeded", 0);
    }

    if (this.apiUrl) {
      const ref = referenceResult.status === "fulfilled" ? referenceResult.value : undefined;
      gauge(
        "reference_rpc_up",
        "Whether the optional reference hk_chainInfo succeeded",
        Number(!!ref),
      );
      if (ref && local) {
        const same = ref.chain_id === local.chain_id && ref.genesis_digest === local.genesis_digest;
        gauge(
          "reference_network_match",
          "Whether reference and local chain ID and genesis digest match",
          Number(same),
        );
        if (same) {
          const height = number(local.height),
            referenceHeight = number(ref.height);
          gauge("reference_block_height", "Reference node height", referenceHeight);
          gauge(
            "sync_lag_blocks",
            "Reference height minus local height, clamped to zero",
            Math.max(0, referenceHeight - height),
          );
          gauge(
            "catching_up",
            "Whether local node is more than 20 blocks behind the reference",
            Number(referenceHeight - height > 20),
          );
          try {
            let matches: boolean;
            if (height === referenceHeight) matches = local.app_hash === ref.app_hash;
            else {
              const block = await this.rpc(
                height < referenceHeight ? this.apiUrl : this.rpcUrl,
                "hk_getBlock",
                { height: Math.min(height, referenceHeight) + 1 },
              );
              if (
                block.found !== true ||
                number(block.height) !== Math.min(height, referenceHeight) + 1
              )
                throw new Error("Comparison block unavailable");
              matches =
                text(block.parent_app_hash) ===
                (height < referenceHeight ? local.app_hash : ref.app_hash);
            }
            gauge("app_hash_check_up", "Whether a same-height state comparison was possible", 1);
            gauge(
              "app_hash_match",
              "Same-height state matches the reference (not proof of reference trust)",
              Number(matches),
            );
          } catch {
            gauge("app_hash_check_up", "Whether a same-height state comparison was possible", 0);
          }
        }
      }
    }
    return registry.metrics();
  }
}
