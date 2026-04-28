# Configuration

## Collector selection

- Preferred: `CHAIN=<collector-id>`
- Legacy compatibility: `BLOCKCHAIN=./availables/<module>.ts`

If both are set, `CHAIN` wins.

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

## Address semantics

| Family       | Address field | Validator field |
| ------------ | ------------- | --------------- |
| Cosmos / EVM | `ADDRESS`     | `VALIDATOR`     |
| Solana       | `VOTE`        | `IDENTITY`      |

Multiple values are comma-separated.

## Solana mainnet current-epoch metrics

The `solana` collector reads current-epoch slot, fee, and tip income data from `https://whoearns.live`. Numeric metrics are emitted whenever the indexer returns a finite value. Completeness is exposed through boolean gauges such as `solana_slots_available`, `solana_income_available`, `solana_validator_epoch_current`, and `solana_validator_epoch_final`.

Income is derived from Solana RPC block data: base fees, priority fees, and on-chain Jito tips. `solana_mev_fees_total_sol` is kept as a compatibility alias for `solana_block_tips_total_sol`; it no longer represents Jito Kobe payout data.
