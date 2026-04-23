# Changelog

All notable changes to this project are documented here.

The format follows Keep a Changelog and this repository uses Semantic Versioning for tagged releases.

## [Unreleased]

### Added

- Typed runtime configuration with `CHAIN`-based collector selection and legacy `BLOCKCHAIN` compatibility.
- OSS baseline files: MIT `LICENSE`, contribution policy, security policy, code of conduct, issue templates, PR template, Husky hooks, ESLint, Prettier, and GitHub Actions.
- Characterization, unit, integration, and smoke tests for runtime config, transport caching, decimal helpers, Tendermint profiles, and server behavior.
- Shared collector modules for Cosmos/Tendermint, Solana, and EVM-oriented runtimes.
- Example environment files under `examples/env/`.

### Changed

- Collector bootstrap now validates required environment variables before startup.
- Prometheus metric timing instrumentation is opt-in through `ENABLE_PROM_PERF`.
- Berachain ERC20 discovery now skips gracefully when `ALCHEMY_API_KEY` is not configured.
- Solana collectors now receive wallet addresses through the factory instead of reading `process.env` directly.

### Fixed

- `/metrics` now returns HTTP 500 when collection fails instead of silently masking request errors.
- Concurrent cached HTTP requests are deduplicated to reduce duplicate network calls.
