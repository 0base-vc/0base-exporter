# 0Base Exporter

[![CI](https://github.com/0base-vc/0base-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/0base-vc/0base-exporter/actions/workflows/ci.yml)
[![Release](https://github.com/0base-vc/0base-exporter/actions/workflows/release.yml/badge.svg)](https://github.com/0base-vc/0base-exporter/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js >=20.19.0](https://img.shields.io/badge/node-%3E%3D20.19.0-339933)](./package.json)

[한국어 README](./README.ko.md)

![0Base Exporter logo](./0base-exporter.png)

Prometheus exporter for validator and wallet metrics across Cosmos/Tendermint, Solana, and EVM-oriented networks.

0Base Exporter exposes a stable `GET /metrics` endpoint, keeps legacy environment-variable workflows intact, and gives operators one small Node.js process for chain-specific validator observability.

## Why Use It

- Export validator, wallet, staking, epoch, and chain-specific metrics in Prometheus format.
- Use one runtime contract across Cosmos/Tendermint, Solana, and EVM-oriented collectors.
- Preserve legacy `BLOCKCHAIN=./availables/...` deployments while moving new deployments to `CHAIN`.
- Run the same quality gate locally and in GitHub Actions through `npm run ci:verify`.

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
curl http://localhost:27770/healthz
curl http://localhost:27770/metrics
```

Sample env files are available in [examples/env](./examples/env).

## Supported Chain Selection

Use the new `CHAIN` variable when possible:

| Family              | Recommended `CHAIN` values                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Cosmos / Tendermint | `tendermint`, `tendermint-v1`, `tendermint-v1beta1`, `terra`, `terra-v2`, `atomone`, `tendermint-umee`, `tendermint-tgrade`, `initia-testnet` |
| Solana              | `solana`, `solana-testnet`                                                                                                                    |
| EVM / Hybrid        | `monad`, `monad-testnet`, `berachain`, `mitosis`, `mitosis-testnet`, `story-testnet`, `canopy-testnet`                                        |

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

## Documentation

- [Quickstart](./docs/en/quickstart.md)
- [Configuration](./docs/en/configuration.md)
- [Supported chains](./docs/en/supported-chains.md)
- [Examples](./docs/en/examples.md)
- [Architecture](./docs/en/architecture.md)
- [Adding a collector](./docs/en/adding-collector.md)
- [Metrics compatibility policy](./docs/en/metrics-policy.md)
- [Troubleshooting](./docs/en/troubleshooting.md)
- [Release policy](./docs/en/release-policy.md)
- [Release checklist](./docs/en/release-checklist.md)
- [Operations guide](./docs/en/operations.md)
- [Changelog](./CHANGELOG.md)

## Contributing And Support

Contributions are welcome when they preserve the exporter contracts that production Prometheus setups depend on.

- Start with [CONTRIBUTING.md](./CONTRIBUTING.md).
- Use GitHub Issues for bugs, feature requests, chain support requests, docs issues, and safe public questions.
- See [SUPPORT.md](./SUPPORT.md) for support boundaries.
- Report vulnerabilities through [SECURITY.md](./SECURITY.md), not public issues.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run ci:verify
```

Pre-commit formatting and linting run through Husky + `lint-staged`. CI runs on Node `20.19.0` and `22.x`.

## License

MIT. See [LICENSE](./LICENSE).
