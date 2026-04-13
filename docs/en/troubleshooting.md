# Troubleshooting

## Startup fails with missing configuration

The new runtime config validates required inputs before binding the HTTP server. Check the error message for the missing variables for your selected `CHAIN`.

## `GET /metrics` returns 500

- Confirm upstream RPC / REST endpoints are reachable.
- Check that addresses and validator identifiers match the selected chain family.
- Run with the same env locally and inspect logs for the failing collector.

## Legacy `BLOCKCHAIN` path does not work

Use `CHAIN` instead. Legacy paths are normalized internally, but unsupported custom file paths are rejected.

## Need to compare metric regressions

Run `npm test` and inspect the fixture-based metric snapshots under `test/integration`.
