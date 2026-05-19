# Support

0Base Exporter is an open source project maintained for Prometheus-based validator and wallet monitoring.

## Where To Ask

- Bugs and regressions: open a bug report issue.
- New chain support: open a chain support request.
- Documentation gaps: open a docs issue.
- Usage questions that do not include secrets: open a safe public question issue.
- Security-sensitive reports: follow [SECURITY.md](./SECURITY.md).

## What To Include

For operational help, include:

- `CHAIN` or legacy `BLOCKCHAIN`;
- Node.js version;
- exporter version or commit SHA;
- relevant environment variable names, with secrets redacted;
- `/healthz` result;
- a short sample of `/metrics` output when safe to share.

Do not post private RPC credentials, validator keys, wallet secrets, bearer tokens, or unreleased vulnerability details in public issues.

## Maintainer Response

Maintainers will prioritize security issues, regressions that break existing metric contracts, and reports with a complete reproduction.
