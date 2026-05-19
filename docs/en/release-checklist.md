# Release Checklist

This repository currently publishes GitHub Release artifacts only. npm publish automation is intentionally out of scope.

## Before Tagging

- Confirm `main` contains the intended release commits.
- Run `npm run ci:verify`.
- Update [CHANGELOG.md](../../CHANGELOG.md) under the target version.
- Confirm user-facing docs are updated in English and Korean when behavior changed.
- Confirm metric or environment-variable compatibility notes are included when needed.

## Tag

Use a Semantic Versioning tag:

```bash
git switch main
git pull --ff-only origin main
git tag v1.2.3
git push origin v1.2.3
```

## After The Workflow

- Verify the Release workflow completed successfully.
- Check that the release contains the npm tarball and `SHA256SUMS.txt`.
- Check generated release notes for misleading entries.
- Confirm no npm package was published by accident.

## Rollback

If the release artifact is wrong:

- mark the GitHub Release as a pre-release or delete it if it has not been consumed;
- delete and recreate the tag only when maintainers agree that no downstream automation consumed it;
- open a follow-up issue with `priority: p1` and the relevant `area:` label.
