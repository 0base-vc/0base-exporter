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

## Address semantics

| Family       | Address field | Validator field |
| ------------ | ------------- | --------------- |
| Cosmos / EVM | `ADDRESS`     | `VALIDATOR`     |
| Solana       | `VOTE`        | `IDENTITY`      |

Multiple values are comma-separated.

For backward compatibility, the runtime still checks `VOTE` before `ADDRESS` and `IDENTITY` before `VALIDATOR`. Prefer the family-specific fields above for new deployments, and avoid setting both aliases unless you intentionally want the legacy value to win.

## Solana mainnet current-epoch metrics

The `solana` collector reads current-epoch slot, fee, and tip income data from `https://whoearns.live`. Numeric metrics are emitted whenever the indexer returns a finite value. Completeness is exposed through boolean gauges such as `solana_slots_available`, `solana_income_available`, `solana_validator_epoch_current`, and `solana_validator_epoch_final`.

Income is derived from Solana RPC block data: base fees, priority fees, and on-chain Jito tips. `solana_mev_fees_total_sol` is kept as a compatibility alias for `solana_block_tips_total_sol`; it no longer represents Jito Kobe payout data.

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
