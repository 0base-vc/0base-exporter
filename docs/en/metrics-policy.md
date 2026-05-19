# Metrics Compatibility Policy

Prometheus users often wire exporter output directly into alerts, dashboards, and long-lived recording rules. Treat metric output as a public contract.

## Stable Contract

The following are compatibility-sensitive:

- metric names;
- label names and label value meaning;
- metric type, for example gauge versus counter;
- required environment variables needed to start a collector;
- endpoint availability for `GET /healthz` and `GET /metrics`.

Patch releases must preserve these contracts unless the fix prevents incorrect or unsafe data from being emitted.

## Allowed Non-Breaking Changes

These changes are normally safe:

- adding a new metric;
- adding support for a new `CHAIN` id;
- adding an optional environment variable;
- improving timeout, cache, or retry behavior without changing emitted metric meaning;
- documenting an existing behavior more clearly.

When adding a metric, include a test or fixture that locks the metric name and label set.

## Breaking Changes

These changes require a major version or explicit migration note:

- removing or renaming a metric;
- changing label names or label semantics;
- changing a metric from exact to partial without an availability indicator;
- changing required startup environment variables;
- removing a legacy `BLOCKCHAIN` alias.

Breaking changes should include dashboard and alert migration notes when practical.

## Partial And Best-Effort Data

Some upstream sources do not provide complete current-epoch data. Collectors may emit lower-bound or partial values only when the metric name, labels, or companion availability metric make that status clear.

For Solana current-epoch metrics, availability gauges such as `solana_slots_available`, `solana_income_available`, `solana_validator_epoch_current`, and `solana_validator_epoch_final` tell operators how complete the related values are.

## Review Requirements

Pull requests that touch metrics must state one of:

- "Metric contract preserved";
- "Metric added, no existing contract changed";
- "Breaking metric change, migration note included".

Reviewers should block metric changes that do not include tests or a documented compatibility decision.
