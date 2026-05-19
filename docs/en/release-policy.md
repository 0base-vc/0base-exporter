# Release Policy

## Branching

- Main development happens on topic branches off `main`.
- Large refactors should use a dedicated integration branch, such as `codex/oss-foundation-refactor`.

## Versioning

- Releases are tagged with Semantic Versioning, for example `v1.2.3`.
- Patch releases should not change metric names, labels, or required environment variables.
- Breaking runtime or metric changes require a major version and an explicit migration note.

## Quality gates

Every pull request is expected to pass:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run docs:lint`
- `npm test`
- `npm run build`
- `npm pack --dry-run`

Tagged releases also run the GitHub release workflow, which verifies the repository, builds the package, creates an npm tarball, and uploads checksum metadata.

## Compatibility

- `GET /metrics` is treated as stable.
- Existing metric names and labels should be preserved unless a breaking change is explicitly documented.
- Legacy `BLOCKCHAIN` values remain supported until a future major release removes them.
