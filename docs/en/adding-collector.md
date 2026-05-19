# Adding A Collector

This guide is the minimum contract for adding a new chain collector without breaking existing exporter behavior.

## Design Checklist

- Pick a stable `CHAIN` id that describes the network, for example `tendermint-foo` or `foo-testnet`.
- Decide whether the collector belongs to an existing family: Cosmos/Tendermint, Solana, EVM, or hybrid.
- Reuse shared collector profiles before adding a bespoke implementation.
- Preserve existing metric names and labels unless the change is explicitly documented as breaking.
- Keep network calls behind the existing transport helpers so cache, timeout, and fallback behavior stay consistent.

## Runtime Registration

Every collector must be registered through the central runtime registry. The registry entry defines:

- the public `CHAIN` id;
- any legacy `BLOCKCHAIN` aliases that should keep working;
- required environment variables for fail-fast startup validation;
- the collector factory or shared profile used at runtime.

New deployments should document `CHAIN`. Legacy aliases are only added when an older deployment path already exists or compatibility with a known script is required.

## Configuration Contract

Use the existing environment variable families:

| Family              | Endpoint variables                | Address variables      |
| ------------------- | --------------------------------- | ---------------------- |
| Cosmos / Tendermint | `API_URL`, optional `RPC_URL`     | `ADDRESS`, `VALIDATOR` |
| Solana              | `RPC_URL`                         | `VOTE`, `IDENTITY`     |
| EVM / Hybrid        | `EVM_API_URL`, optional `API_URL` | `ADDRESS`, `VALIDATOR` |

If a collector needs a new variable, document why the existing variables are insufficient and add it to the configuration reference.

## Tests

Add or update tests for:

- registry resolution and required env validation;
- metric output shape, especially metric names and labels;
- upstream failure behavior and fallback behavior;
- any legacy `BLOCKCHAIN` alias that must remain supported.

Fixture-based tests are preferred for external APIs. Avoid tests that depend on live public endpoints.

## Documentation

Update these files when behavior changes:

- [configuration](./configuration.md)
- [supported chains](./supported-chains.md)
- [examples](./examples.md)
- [metrics compatibility policy](./metrics-policy.md), when metric contracts change
- [Korean README](../../README.ko.md), when user-facing setup changes

## Pull Request Expectations

Collector pull requests should explain:

- which endpoints the collector calls;
- whether the metrics are exact, partial, or best-effort;
- whether any metric names, labels, or required environment variables change;
- which local commands and fixtures validate the change.
