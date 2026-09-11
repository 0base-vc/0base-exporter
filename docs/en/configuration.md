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
