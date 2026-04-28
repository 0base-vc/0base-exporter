# 0Base Exporter

Prometheus exporter for validator and wallet metrics across Cosmos/Tendermint, Solana, and EVM-oriented networks.

0Base Exporter exposes a stable `GET /metrics` endpoint and keeps legacy environment-variable workflows intact while adding a typed runtime config layer, test coverage, linting, Git hooks, and CI suitable for public open source development.

## Quickstart

```bash
npm ci
npm run build

CHAIN=tendermint \
API_URL=http://localhost:1317 \
ADDRESS=cosmos1youraddress \
VALIDATOR=cosmosvaloper1yourvalidator \
npm start
```

Then scrape:

```bash
curl http://localhost:27770/metrics
```

Sample env files are available in [examples/env](./examples/env).

## Supported Chain Selection

Use the new `CHAIN` variable when possible:

| Family              | Recommended `CHAIN` values                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Cosmos / Tendermint | `tendermint`, `tendermint-v1`, `tendermint-v1beta1`, `terra`, `terra-v2`, `atomone`, `tendermint-umee` |
| Solana              | `solana`, `solana-testnet`                                                                             |
| EVM / Hybrid        | `monad`, `monad-testnet`, `berachain`, `mitosis`, `mitosis-testnet`, `story-testnet`, `canopy-testnet` |

Legacy `BLOCKCHAIN=./availables/...` values are still supported and mapped internally to `CHAIN`.

## Configuration

Common variables:

| Variable               | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| `PORT`                 | HTTP listen port. Defaults to `27770`.                     |
| `CHAIN`                | Preferred collector id.                                    |
| `BLOCKCHAIN`           | Legacy module-path selector kept for compatibility.        |
| `API_URL`              | REST API for Cosmos-style collectors.                      |
| `RPC_URL`              | RPC endpoint for Cosmos or Solana collectors.              |
| `EVM_API_URL`          | JSON-RPC endpoint for EVM-oriented collectors.             |
| `ADDRESS`              | Wallet / delegator address list for non-Solana collectors. |
| `VALIDATOR`            | Validator address list for non-Solana collectors.          |
| `VOTE`                 | Solana vote account list.                                  |
| `IDENTITY`             | Solana identity account list.                              |
| `EXISTING_METRICS_URL` | Existing Prometheus endpoints to merge into the output.    |
| `ENABLE_PROM_PERF`     | Opt-in instrumentation for internal metric timing.         |

The Solana mainnet collector uses the hosted 0Base validator indexer for current-epoch slot, fee, and MEV metrics. Slot and fee metrics are emitted for both `partial` and `exact` statuses as running lower bounds, while MEV metrics remain `exact` only.

See the full reference:

- [Configuration](./docs/en/configuration.md)
- [Supported chains](./docs/en/supported-chains.md)
- [Examples](./docs/en/examples.md)
- [Architecture](./docs/en/architecture.md)
- [Troubleshooting](./docs/en/troubleshooting.md)
- [Release policy](./docs/en/release-policy.md)
- [Changelog](./CHANGELOG.md)
- [Korean README](./README.ko.md)

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Pre-commit formatting and linting run through Husky + `lint-staged`. CI runs on Node `20.x` and `22.x`.

## Project Image

![0Base Exporter logo](./0base-exporter.png)

## License

MIT. See [LICENSE](./LICENSE).
