# `@stacksee/analytics` Retirement Release Design

**Date:** 2026-07-21
**Status:** Approved for planning

## Goal

Publish one final functional `@stacksee/analytics` version whose npm page clearly
directs users to `trakoo`, then replace npm's generic deprecation text with a
specific migration message.

The maintained `trakoo` package, its README, and its `main` branch identity must
not be changed to produce this legacy release.

## Chosen Approach

Create a short-lived branch and temporary worktree from the existing
`@stacksee/analytics@0.14.5` tag. In that isolated checkout:

- keep the package name `@stacksee/analytics`;
- bump only the legacy package version to `0.14.6`;
- retain the working library source, exports, and built artifacts;
- replace the long legacy README with a minimal migration notice;
- point repository metadata directly to `multiplehats/trakoo`;
- verify, publish, deprecate, tag, and then remove the temporary branch and
  worktree.

The retirement commit will not be merged into `main`. A pushed
`@stacksee/analytics@0.14.6` Git tag will preserve the exact source of the npm
artifact for auditability.

## README Notice

The final README will contain only:

````md
# Moved to Trakoo

This package has moved to [trakoo](https://www.npmjs.com/package/trakoo).

```sh
npm uninstall @stacksee/analytics
npm install trakoo
```

Update imports from `@stacksee/analytics` to `trakoo`.

Source: https://github.com/multiplehats/trakoo
````

This keeps the old npm landing page focused on the required action while still
providing both registry and source links.

## npm Deprecation Message

After `0.14.6` is published, deprecate the complete legacy version range with:

```text
This package has moved to trakoo. Install `trakoo` instead: https://www.npmjs.com/package/trakoo
```

The command must target `@stacksee/analytics@*` so the new retirement release
and every historical version show the same actionable warning. The deprecation
does not unpublish or break any existing version.

## Release Safety

Before publication:

1. Confirm npm authentication resolves to the intended owner.
2. Confirm `@stacksee/analytics@0.14.6` does not already exist.
3. Run the frozen install, typecheck, lint, tests, and build from the isolated
   legacy checkout. The approved lint exception is exactly seven pre-existing
   violations in two untouched test files; any other lint result stops the
   release so the retirement commit remains limited to its two published files.
4. Inspect `npm pack --dry-run --json` and require the exact scoped name,
   version `0.14.6`, the minimal README, and the same constrained functional
   package contents as the previous release.
5. Stop on any unexpected registry state or tarball content.

Publish exactly once with public access. If browser authorization or the CLI
result is ambiguous, query the registry before retrying.

## Verification

Completion requires independent registry checks proving:

- `@stacksee/analytics@0.14.6` exists and is the `latest` legacy version;
- its README contains the Trakoo migration notice and no legacy documentation;
- its repository URL points to `multiplehats/trakoo`;
- its deprecation message is the exact actionable migration message;
- `trakoo@0.0.0` remains unchanged;
- the pushed `@stacksee/analytics@0.14.6` Git tag resolves to the committed
  retirement source.

After verification, remove the temporary worktree and delete its local branch.
The pushed tag and immutable npm version remain as the release record.

## Explicit Non-Goals

- Do not replace or shorten the `trakoo` README.
- Do not merge the legacy package identity back into `main`.
- Do not unpublish any `@stacksee/analytics` version.
- Do not publish an empty or intentionally broken tombstone package.
- Do not create another `trakoo` release.
