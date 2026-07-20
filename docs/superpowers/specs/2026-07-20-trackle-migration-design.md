# Trakoo Package Migration and Trusted Publishing Design

## Goal

Move the working analytics library from the npm package `@stacksee/analytics`
to the unscoped personal package `trakoo`, move its GitHub repository from
`stackseehq/analytics` to `multiplehats/trakoo`, and publish future releases
through npm Trusted Publishing with GitHub Actions OIDC.

The first `trakoo` release will be the functional library at version `0.0.0`.
Publishing that bootstrap release promptly is important because the unscoped
name is currently available and npm package names are allocated globally.

## Current State

- npm package: `@stacksee/analytics@0.14.4`
- local package version: an uncommitted change to `0.14.5`
- GitHub repository: `stackseehq/analytics`
- release orchestration: Changesets through `.github/workflows/release.yml`
- npm authentication: a long-lived `NPM_TOKEN`
- local npm CLI: currently unauthenticated (`npm whoami` returns `E401`)
- pending changeset: the CJS default-export fix already present at `HEAD`

The local `0.14.5` version change will be intentionally superseded by the new
package's bootstrap version, `0.0.0`.

The initial replacement candidate was the name `track` + `le`, but npm rejected
it as too similar to `tsickle`. No package was published, and the user selected
`trakoo` as the replacement identity.

## Chosen Migration Strategy

Use a local authenticated publish for the bootstrap release, then configure
Trusted Publishing for every later release.

This order is required because npm Trusted Publisher settings belong to an
existing npm package. It also minimizes the time during which another npm user
could publish the currently available `trakoo` name. No temporary npm token
will be added to the new GitHub Actions configuration.

The rejected alternatives are:

- completing the entire repository migration before publishing, which leaves
  the npm name available longer; and
- using a temporary `NPM_TOKEN` release from GitHub Actions, which introduces a
  credential path that would immediately need to be removed.

## Package Migration

The root package metadata will change to:

- name: `trakoo`
- version: `0.0.0`
- repository: `multiplehats/trakoo`
- public npm access through the existing Changesets `access: public` setting

The bootstrap tarball will contain the current working library, including the
CJS default-export compatibility fix. It will not be an empty placeholder.

Active documentation, README installation instructions, source-code examples,
test descriptions, end-to-end fixtures, and workspace dependency references
will use `trakoo`. Clearly historical changelog entries may continue to refer
to `@stacksee/analytics`, while the active changelog heading and future entries
will use `trakoo`.

The docs workspace dependency will change from `@stacksee/analytics` to
`trakoo`, and `pnpm-lock.yaml` will be regenerated from the workspace rather
than edited manually.

The pending CJS changeset will be consumed by the bootstrap release and
removed. Retaining it would incorrectly create an immediate `0.0.1` release
for code already included in `0.0.0`.

## Repository Migration

The GitHub repository will be transferred from the `stackseehq` organization
to the `multiplehats` user and renamed from `analytics` to `trakoo`. Package
metadata, Changesets changelog configuration, issue links, homepage links, and
the local Git remote will point to `multiplehats/trakoo`.

The package metadata may briefly point to the future repository URL between
the npm bootstrap publish and GitHub transfer. That short interval is accepted
in favor of claiming the npm name promptly.

## Trusted Publishing Workflow

The existing `.github/workflows/release.yml` remains the only release
orchestrator. It will continue to use `changesets/action@v1` and
`pnpm ci:publish`, preserving release pull requests, version updates, GitHub
releases, tags, and npm publication.

The release workflow will mirror the proven `multiplehats/wc-now` setup:

- grant `contents: write`, `pull-requests: write`, and `id-token: write`;
- remove `packages: write`, which is for GitHub Packages rather than npm;
- run on Node.js 24 with an npm version that supports Trusted Publishing;
- leave `registry-url` unset so `actions/setup-node` does not create token
  authentication or export a dummy `NODE_AUTH_TOKEN`;
- disable package-manager caching in the release job;
- remove `NPM_TOKEN` from the Changesets action environment; and
- let npm Trusted Publishing generate provenance automatically rather than
  passing an explicit `--provenance` flag.

The npm Trusted Publisher will be configured as:

- package: `trakoo`
- provider: GitHub Actions
- organization or user: `multiplehats`
- repository: `trakoo`
- workflow filename: `release.yml`
- allowed action: `npm publish`
- environment: none

## Publish Flow

1. Recheck that `npm view trakoo` returns `E404` immediately before the
   bootstrap publish.
2. Authenticate the local npm CLI interactively, display the result of
   `npm whoami`, and obtain explicit confirmation that it is the intended
   personal owner before changing registry state.
3. Apply the package rename and bootstrap version, build the project, and
   inspect the exact npm tarball contents.
4. Publish `trakoo@0.0.0` locally with the authenticated personal npm account.
5. Verify the immutable registry result with `npm view trakoo@0.0.0`.
6. Transfer and rename the GitHub repository to `multiplehats/trakoo` and
   update the local Git remote.
7. Configure npm Trusted Publishing with the exact identity above.
8. Push the OIDC-compatible release workflow.
9. Use the first later Changesets release as the end-to-end OIDC validation.
10. Remove the old GitHub npm secret and optionally disallow token publishing
    only after a successful Trusted Publishing release.

## Error Handling and Safety

- Name availability will be checked again immediately before publishing. If
  `trakoo` has become occupied, publishing stops without choosing a different
  name automatically.
- The local CLI is currently unauthenticated. `npm whoami` must identify an
  account that the owner explicitly confirms before publication. An unexpected
  or unauthenticated identity stops the publish.
- If npm requests 2FA or interactive authentication, execution pauses for the
  account owner rather than weakening authentication.
- The tarball is inspected before publication because npm versions are
  immutable after a successful publish.
- If a publish command returns an ambiguous failure, the registry is queried
  before retrying. The same version is not blindly republished.
- Trusted Publisher fields are exact and case-sensitive. A mismatch is expected
  to fail closed because no npm token fallback will remain in the workflow.
- Existing user changes outside the migration scope will be preserved.

## Verification

Before publishing `0.0.0`:

- run type checking, linting, unit tests, and the production build;
- regenerate and verify the workspace lockfile;
- inspect `npm pack --dry-run` output for required files and unwanted data;
- verify no active package references still use `@stacksee/analytics`;
- validate the release workflow's YAML formatting; and
- statically assert that OIDC and Node 24 are present while `registry-url`,
  `NPM_TOKEN`, `NODE_AUTH_TOKEN`, and `packages: write` are absent.

After publication and repository migration:

- verify `trakoo@0.0.0` through the npm registry;
- verify the Git remote and all active repository metadata point to
  `multiplehats/trakoo`; and
- confirm the first post-bootstrap release log reports npm OIDC Trusted
  Publishing and npm displays provenance linked to `release.yml`.

The first post-bootstrap release is the only complete authentication test;
local checks cannot reproduce GitHub's OIDC identity exchange.

## Out of Scope

- Redirecting imports from the old npm package automatically.
- Deprecating or unpublishing `@stacksee/analytics` during the bootstrap claim.
- Changing the Changesets release model or the `main` and `next` release
  branches.
- Adding a GitHub deployment environment or staged npm publishing.
- Removing legacy credentials before OIDC succeeds once.
