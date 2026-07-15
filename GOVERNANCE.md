# Governance

0Base Exporter uses a lightweight maintainer model.

## Maintainers

Maintainers are listed in [MAINTAINERS.md](./MAINTAINERS.md). Maintainers can triage issues, review pull requests, merge changes, publish GitHub Releases, and update repository settings.

## Decision Making

Routine changes can be merged after CI passes, review comments are resolved, and the pull request has at least one approving review.

Changes that affect metric contracts, required environment variables, release process, or repository security settings should be discussed in an issue or pull request before merge.

## Compatibility

Maintainers should preserve:

- `GET /metrics` and `GET /healthz` availability;
- existing metric names and labels;
- legacy `BLOCKCHAIN` aliases;
- documented environment-variable precedence.

Breaking changes require a major version or explicit migration note.

## Escalation

Security-sensitive concerns follow [SECURITY.md](./SECURITY.md). Conduct concerns follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
