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
