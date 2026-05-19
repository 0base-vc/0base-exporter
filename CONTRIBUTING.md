# Contributing

## Development workflow

1. Install dependencies with `npm ci`.
2. Create or update tests before changing behavior.
3. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
4. Submit focused pull requests with clear migration notes if a change affects runtime configuration or metric output.

## TDD expectations

- Add characterization tests before refactoring collector behavior.
- Preserve metric names and labels unless the pull request explicitly documents a breaking change.
- Prefer fixture-based tests for external API integrations.

## Local hooks

- `pre-commit`: runs `lint-staged`
- `pre-push`: runs `npm run typecheck`

## Pull request checklist

- Tests updated or added
- Docs updated in English and Korean when user-facing behavior changed
- Legacy compatibility considered for `BLOCKCHAIN`, env vars, and metric output
