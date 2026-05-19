# Operations Guide

This guide describes how maintainers run the public repository.

## Repository Settings

Recommended settings:

- description: `Prometheus exporter for validator and wallet metrics across Cosmos, Solana, and EVM networks`;
- topics: `prometheus`, `exporter`, `blockchain`, `validator`, `cosmos`, `solana`, `evm`, `observability`;
- Issues: enabled;
- Discussions: enabled;
- Projects: enabled;
- Wiki: disabled;
- delete branch on merge: enabled;
- merge commits and squash merges: enabled;
- rebase merges: disabled.

## Main Branch Protection

Use a solo-maintainer-friendly protection rule for `main`:

- require pull requests before merging;
- require status checks `verify (20.19.0)` and `verify (22.x)`;
- require conversation resolution before merge;
- allow maintainers to use emergency bypass when the repository owner permits it;
- do not require approving reviews until there is a larger maintainer team.

When the maintainer team grows, add required approvals and CODEOWNERS review.

## Labels

Use labels with predictable prefixes:

- `type: bug`, `type: feature`, `type: docs`, `type: security`, `type: refactor`, `type: dependencies`;
- `area: cosmos`, `area: solana`, `area: evm`, `area: runtime`, `area: ci`, `area: docs`;
- `priority: p0`, `priority: p1`, `priority: p2`, `priority: p3`;
- `status: needs-info`, `status: blocked`, `status: good-first-issue`, `status: help-wanted`.

Keep the default GitHub labels only when they remain useful for contributors.

## Discussions And Projects

Use Discussions for design, operational questions, and ideas that are not yet actionable issues.

Use one project board named `0Base Exporter Roadmap` with these fields:

- `Status`: Backlog, Ready, In progress, In review, Done;
- `Priority`: P0, P1, P2, P3;
- `Area`: Cosmos, Solana, EVM, Runtime, CI, Docs.

Issues should stay small enough to be closed by one focused pull request.

## Action Pinning

Release and security-sensitive workflows should pin third-party actions by full commit SHA. General CI may use maintained major tags when Dependabot monitors GitHub Actions updates.

Document any exception in the workflow comments.
