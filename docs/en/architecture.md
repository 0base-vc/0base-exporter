# Architecture

## Runtime flow

1. `src/index.ts` boots the process and handles fatal startup failures.
2. `src/core/config.ts` parses and validates environment variables.
3. `src/core/collector-registry.ts` resolves `CHAIN` or legacy `BLOCKCHAIN` values to a collector.
4. `src/server.ts` exposes `GET /healthz` and `GET /metrics`.
5. `src/target.abstract.ts` provides shared transport, fallback, and cache helpers.

## Design notes

- Collector implementations are still chain-specific, but runtime resolution is now centralized.
- HTTP helpers now deduplicate concurrent cache misses to reduce duplicate upstream requests during parallel scrapes.
- Prometheus performance patching is opt-in through `ENABLE_PROM_PERF`.
- Background jobs such as Berachain token scanning now use collector lifecycle hooks instead of constructor side effects.
