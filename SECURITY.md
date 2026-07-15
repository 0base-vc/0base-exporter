# Security Policy

Please report security-sensitive issues privately instead of opening a public GitHub issue.

Preferred private reporting channel:
[GitHub private vulnerability report](https://github.com/0base-vc/0base-exporter/security/advisories/new).

## Supported Versions

Security fixes target the `main` branch and the latest tagged GitHub Release. Older untagged commits are not supported unless maintainers explicitly decide otherwise.

## Reporting

- Open a [GitHub private vulnerability report](https://github.com/0base-vc/0base-exporter/security/advisories/new).
- If GitHub private reporting is unavailable, contact the maintainer listed in [MAINTAINERS.md](./MAINTAINERS.md) before disclosing details publicly.
- Do not include secrets, private RPC credentials, validator keys, or exploit details in public issues or discussions.

Maintainers will acknowledge actionable reports as soon as practical and will coordinate disclosure timing for confirmed vulnerabilities.

## Scope

This project handles exporter-side metric collection and local configuration. Reports involving credential leakage, unsafe remote code loading, dependency supply-chain risk, unexpected network exposure, or unsafe handling of upstream data are in scope.

Reports about public chain data quality, third-party RPC uptime, or hosted indexer freshness are usually operational issues unless they cause unsafe exporter behavior.
