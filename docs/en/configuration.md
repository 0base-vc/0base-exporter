# Configuration

## Collector selection

- Preferred: `CHAIN=<collector-id>`
- Legacy compatibility: `BLOCKCHAIN=./availables/<module>.ts` or a Node-resolvable module specifier

If both are set, `CHAIN` wins.

Registered legacy `BLOCKCHAIN` paths are mapped to the matching `CHAIN` entry. Unknown legacy values are still loaded dynamically for backward compatibility, so custom collectors can keep using old module paths or package specifiers as long as they export a compatible collector class.

## Core variables

| Variable               | Required when               | Notes                                                           |
| ---------------------- | --------------------------- | --------------------------------------------------------------- |
| `PORT`                 | Optional                    | Defaults to `27770`.                                            |
| `CHAIN`                | Recommended                 | Maps to a registry entry.                                       |
| `BLOCKCHAIN`           | Legacy                      | Deprecated path-based selector.                                 |
| `API_URL`              | Cosmos / hybrid collectors  | REST API base URL.                                              |
| `RPC_URL`              | Solana, optional for Cosmos | Defaults to `http://localhost:26657` for non-Solana collectors. |
| `EVM_API_URL`          | EVM / hybrid collectors     | JSON-RPC base URL.                                              |
| `EXISTING_METRICS_URL` | Optional                    | Comma-separated Prometheus endpoints to merge.                  |
| `ENABLE_PROM_PERF`     | Optional                    | Enables internal Prometheus gauge timing instrumentation.       |

For `ritual-testnet`, set `API_URL` to the Ritual CL JSON-RPC endpoint and
`EVM_API_URL` to the Ritual EL JSON-RPC endpoint. Use `EXISTING_METRICS_URL` for
the node-native EL/CL Prometheus endpoints that should be merged into the
exporter output.

## Push Chain Donut testnet

Set `CHAIN=push-testnet`, `API_URL` to the Cosmos REST endpoint, `RPC_URL` to
the CometBFT endpoint, `ADDRESS` to the Push account, and `VALIDATOR` to the
Push valoper address. The collector uses the shared Cosmos v1 profile, so the
existing `tendermint_*` metric names and labels remain unchanged. It calls the
standard bank, account, staking, distribution, governance, and CometBFT
validator endpoints. Push amounts always use 18 decimals regardless of
`DECIMAL_PLACES`; unbonding balances without a denom are labeled `upc`, and
rewards are read from the standard top-level `total` field. Set
`PUSH_REFERENCE_RPC_URL` to compare local and reference `/status` and same-height
`app_hash` values. The resulting `push_validator_*` health metrics are emitted
from the same `/metrics` response as the Cosmos metrics. The aliases `push`,
`testnet/push`, and `BLOCKCHAIN=./availables/testnet/push.ts` remain available.

## Address semantics

| Family       | Address field | Validator field |
| ------------ | ------------- | --------------- |
| Cosmos / EVM | `ADDRESS`     | `VALIDATOR`     |
| Solana       | `VOTE`        | `IDENTITY`      |

Multiple values are comma-separated.

For backward compatibility, the runtime still checks `VOTE` before `ADDRESS` and `IDENTITY` before `VALIDATOR`. Prefer the family-specific fields above for new deployments, and avoid setting both aliases unless you intentionally want the legacy value to win.

## FireBAM native metrics

For `CHAIN=solana` or `CHAIN=solana-testnet`, optionally set
`FIREBAM_METRICS_URL=http://validator-host:27770/metrics`. Legacy Solana
`BLOCKCHAIN` selectors support the same option. Each scrape uses a fresh
four-second request independent of Solana RPC collection. All native names,
labels, HELP/TYPE metadata, counters and histograms are preserved, including
snapshot, replay, `bam_*` and `pack_bam_*` metrics. The endpoint must expose
`bam_enabled`, so enable the BAM tile at validator startup.

`solana_firebam_metrics_up` is 1 for a successful current native scrape and 0
for a failure; it is not `bam_healthy`. Failures omit native values instead of
replaying cached healthy state. Without the option, no FireBAM request or new
health metric is emitted. Existing metric contracts are unchanged.

Use this option instead of `EXISTING_METRICS_URL` for FireBAM, because the
latter retains legacy stale-fallback behavior. The same canonical URL is
automatically excluded from the legacy merge to avoid duplicate/stale samples.
Do not configure the same source under different aliases in both settings, or
point the option at another exporter.

On the same host, keep FireBAM on 27770 and set exporter `PORT=27771`. In
Kubernetes, keep exporter port 27770 and use the remote validator's reachable
address, not the Pod's localhost. Allow TCP 27770 from the observed cluster
egress IP at the validator firewall. No keys or SSH access are required.
See [the env example](../../examples/env/firebam.env).

Alert on `solana_firebam_metrics_up == 0` for scrape failure. Interpret
`bam_healthy` separately: startup and unstaked identities may not connect;
a live stream alone does not prove fresh work arrived for a leader slot.

## Solana mainnet current-epoch metrics

The `solana` collector reads current-epoch slot, fee, and tip income data from `https://whoearns.live`. Numeric metrics are emitted whenever the indexer returns a finite value. Completeness is exposed through boolean gauges such as `solana_slots_available`, `solana_income_available`, `solana_validator_epoch_current`, and `solana_validator_epoch_final`.

Income is derived from Solana RPC block data: base fees, priority fees, and on-chain Jito tips. `solana_mev_fees_total_sol` is kept as a compatibility alias for `solana_block_tips_total_sol`; it no longer represents Jito Kobe payout data.

## Limonata testnet

Use `CHAIN=limonata-testnet` with `API_URL` (Cosmos REST), `RPC_URL` (CometBFT),
`ADDRESS` (cosmos account) and `VALIDATOR` (cosmosvaloper operator).
Legacy `BLOCKCHAIN=./availables/testnet/limonata.js` is also supported.
`EXISTING_METRICS_URL` optionally appends native Prometheus metrics.
Limonata fixes aLIMO conversion at 18 decimals; `DECIMAL_PLACES` does not override it.

The collector reuses Cosmos bank, delegation, unbonding, rewards, commission,
account sequence, bonded rank, staking params and governance profiles.
These retain `tendermint_*` metric names. Amounts are LIMO (labels retain `aLIMO`).
Rank 0 means absent from the returned bonded set; rank is limited to the first 256
validators (the current testnet maximum is 100).

Additional `limonata_*` gauges expose `rpc_up`, `cosmos_up`, `peers_up`,
`validator_query_up`, `latest_block_height`, `latest_block_time_seconds`,
`catching_up`, `voting_power`, `peers`, `validator_bonded`, `validator_jailed`,
and `validator_tokens`. Availability gauges describe the current scrape.
A missing validator query is unavailable, not proof of unbonded status.
Failed requests never replay cached successes; partial Cosmos data is marked by
`limonata_cosmos_up=0`. Native metrics retain the common name normalization
(`cometbft` to `tendermint`). No DKG membership is inferred from rank, and no
Proving Grounds score is fabricated.

Limonata: only aLIMO coin amounts are exported. Optional native metric failures retain chain metrics and set `limonata_native_metrics_up=0`.

## HashKinetics testnet

Set `CHAIN=hashkinetics-testnet`, `RPC_URL=http://127.0.0.1:26000`, and optionally
`API_URL=https://rpc.hashkinetics.org` for a reference node. `RPC_URL` is required
and has no Tendermint default for this collector. `VALIDATOR` is an optional
96-character hex **public** `root_pk` from `validator.json`, not a private key or
an operational consensus address. Root identity remains stable across rotations.
Legacy `BLOCKCHAIN=./availables/testnet/hashkinetics.js` is also supported.
See [the environment example](../../examples/env/hashkinetics-testnet.env).

The collector calls local `hk_chainInfo` and `hk_getValidators`, optional reference
`hk_chainInfo`, and at most one `hk_getBlock` on the ahead node to compare the
parent state at the lower height. Calls have a 4-second timeout, concurrent
scrapes share one collection, and failures never reuse stale successes. The
`postFresh` transport helper leaves existing collectors' fallback behavior unchanged.

Metrics use the additive `hashkinetics_` prefix:

- Availability: `rpc_up`, `validator_query_up`, optional `reference_rpc_up`,
  `reference_network_match`, and `app_hash_check_up`.
- Sync: `latest_block_height`, `peer_count`, `last_progress_time_seconds`,
  optional `reference_block_height`, `sync_lag_blocks`, `catching_up` (lag > 20),
  and `app_hash_match` (same-height comparison).
- Local validator set: `active_validators`, `total_voting_power`, `quorum_power`,
  optional `validator_active`, `validator_voting_power`, and `validator_epoch`.
- Signing key: `signer_remaining`, `signer_capacity`, `signer_remaining_ratio`,
  `signer_epoch`; process: `node_rss_bytes`, `node_uptime_seconds`,
  `verifier_init_milliseconds`; `network_info{chain_id,version}` is a constant 1.

Unavailable data is omitted, not reported as zero or inactive. An observer has
`validator_active=0` only when the local set was successfully read. Set membership
reflects the local height; check synchronization before interpreting admission.
Progress age is the exporter's last observed height change, resets on exporter
restart, and is **not** chain block time (HashKinetics timestamps are synthetic).
A failed reference check is unknown, not a chain fork. No wallet balance,
commission, or missed-vote metrics are fabricated. Existing metric contracts are unchanged.

Limonata collection uses one shared four-second request deadline, including native endpoints. Partial native failures retain successful endpoint metrics and report `limonata_native_metrics_up=0`.

## SphereNet testnet

Use `CHAIN=spherenet-testnet` with `RPC_URL` and `VOTE` (one or more vote
account addresses). `IDENTITY` is accepted as an optional compatibility
setting; the collector labels the identity returned by the RPC and does not
use a configured identity for filtering. `GENESIS_HASH` and `SHRED_VERSION`
are optional verification inputs and should come from the SphereNet operator.
The collector calls `getHealth`, `getSlot`, `getEpochInfo`, `getIdentity`,
`getVersion`, `getGenesisHash`, `getClusterNodes`, and `getVoteAccounts` on the
configured RPC only. It does not query Solana mainnet indexers. The
`spherenet_cluster_node_count` metric is the cluster membership returned by
`getClusterNodes`, not the number of directly connected peers. A missing
configured vote account is unavailable, while a delinquent account is
explicitly reported as `spherenet_validator_active=0`.

## Marinade bid reference

`solana_marinade_min_effective_bid_sol` uses the latest published Marinade scoring
results, with separate `commission="5", mev_commission="10"` and
`commission="5", mev_commission="0"` scenarios. Values are SOL per 1,000 delegated
SOL per epoch. `solana_marinade_bid_reference_epoch` identifies the source epoch
and is `NaN` when the reference is unavailable.
This is a published auction reference, not a prediction of the next auction or a
validator's on-chain commission setting. Staking and MEV percentages in Grafana
profit estimates must be configured separately for each validator.

The collector derives the winning cutoff from the lowest total revenue share
among validators awarded stake, and recovers gross inflation and MEV rewards
from the same epoch's scored revenue shares and commission rates. It does not
rerun the Marinade SDK, which requires upstream validator credit data that may
be unavailable. Missing or invalid scoring data does not produce a zero bid.

Migration: the bid metric keeps its name and labels, but now describes the latest
published auction instead of a freshly simulated auction. Interpret dashboard
and alert thresholds together with the reference epoch. Both commission scenarios
are published for every configured vote account; filter `vote`, `commission`, and
`mev_commission` explicitly rather than taking a maximum across scenarios.
