# Contributing

Thanks for helping improve 0Base Exporter. The main rule is to preserve runtime and metric compatibility unless the pull request explicitly documents a breaking change.

## Development Workflow

1. Install dependencies with `npm ci`.
2. Create or update tests before changing behavior.
3. Run `npm run ci:verify` before opening a pull request.
4. Submit focused pull requests with migration notes when runtime configuration or metric output changes.

## TDD Expectations

- Add characterization tests before refactoring collector behavior.
- Preserve metric names and labels unless the pull request explicitly documents a breaking change.
- Prefer fixture-based tests for external API integrations.
- Avoid tests that depend on live public RPC or REST endpoints.

## Collector Changes

Read [Adding A Collector](./docs/en/adding-collector.md) before adding or changing chain support. Collector pull requests should document endpoint usage, required environment variables, metric completeness, and legacy `BLOCKCHAIN` compatibility.

## Metric Compatibility

Read [Metrics Compatibility Policy](./docs/en/metrics-policy.md) before adding, removing, or renaming metrics. Pull requests that touch metrics must state whether the metric contract is preserved, extended, or intentionally broken with a migration note.

## Local Hooks

- `pre-commit`: runs `lint-staged`
- `pre-push`: runs `npm run typecheck`

## Pull Request Checklist

- Tests updated or added
- Docs updated in English and Korean when user-facing behavior changed
- Legacy compatibility considered for `BLOCKCHAIN`, env vars, and metric output
- Copilot review comments resolved or intentionally answered
