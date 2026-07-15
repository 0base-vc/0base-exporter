# Operations Guide

This guide describes how maintainers run the public repository.

## Repository Settings

Recommended settings:

- description: `Prometheus exporter for validator and wallet metrics across Cosmos, Solana, and EVM networks`;
- topics: `prometheus`, `exporter`, `blockchain`, `validator`, `cosmos`, `solana`, `evm`, `observability`;
- Issues: enabled;
- Discussions: disabled;
- Projects: disabled;
- Wiki: disabled;
- delete branch on merge: enabled;
- merge commits and squash merges: enabled;
- rebase merges: disabled.

## Main Branch Protection

Use a solo-maintainer-friendly protection rule for `main`:

- require pull requests before merging;
- require one approving review before merging;
- dismiss stale approvals when new commits are pushed;
- require status checks `verify (20.19.0)`, `verify (22.x)`, `analyze`, `dependency-review`, and `scorecard-pr`;
- require conversation resolution before merge;
- allow maintainers to use emergency bypass when the repository owner permits it;
- require CODEOWNERS review only after the maintainer team grows beyond a single maintainer.

## Labels

Use labels with predictable prefixes:

- `type: bug`, `type: feature`, `type: docs`, `type: security`, `type: refactor`, `type: dependencies`, `type: support`;
- `area: cosmos`, `area: solana`, `area: evm`, `area: runtime`, `area: ci`, `area: docs`;
- `priority: p0`, `priority: p1`, `priority: p2`, `priority: p3`;
- `status: needs-info`, `status: blocked`, `status: good-first-issue`, `status: help-wanted`.

Keep the default GitHub labels only when they remain useful for contributors.

## Issue Tracking

Use issues as the source of truth for planned work. Every actionable bug, feature, chain support request, docs task, dependency update, and CI task should live as an issue or pull request with the repository label taxonomy.

Keep issues small enough to be closed by one focused pull request. Use `priority:` labels instead of a separate roadmap board.

## Action Pinning

Release, CI, and security-sensitive workflows should pin third-party actions by full commit SHA. Dependabot monitors GitHub Actions updates and opens SHA bump pull requests.

Document any exception in the workflow comments.
