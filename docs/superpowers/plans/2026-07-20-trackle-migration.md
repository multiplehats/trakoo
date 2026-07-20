# Trakoo Package Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the working library as `trakoo@0.0.0`, move its repository to `multiplehats/trakoo`, and prepare all later Changesets releases to use npm Trusted Publishing through GitHub Actions OIDC.

**Architecture:** Claim the npm name first with one carefully verified local publish, because Trusted Publisher settings require an existing package. Preserve Changesets as the release orchestrator, migrate the repository, and then bind npm to the exact `multiplehats/trakoo` and `release.yml` OIDC identity with no token fallback.

**Tech Stack:** npm registry, npm CLI, pnpm 9.14.4, Changesets, GitHub Actions, Node.js 24, npm Trusted Publishing/OIDC, GitHub CLI

## Global Constraints

- The new public package name is exactly `trakoo`, installed with `npm install trakoo`.
- The bootstrap package version is exactly `0.0.0` and contains the current functional library.
- The destination repository is exactly `multiplehats/trakoo`.
- Preserve Changesets and the `main` and `next` release branches.
- The Trusted Publisher workflow filename is exactly `release.yml`, with allowed action `npm publish` and no GitHub environment.
- The release workflow must not contain `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or `registry-url`.
- Keep the old GitHub `NPM_TOKEN` secret until a later OIDC release succeeds, but do not expose it to the workflow.
- Do not deprecate or unpublish `@stacksee/analytics` in this migration.
- Stop before publishing if `trakoo` no longer returns `E404` or the authenticated npm owner is not explicitly confirmed.
- Preserve unrelated user changes; the existing uncommitted `0.14.5` edit is intentionally replaced by `0.0.0`.

---

## File Map

- `package.json`: npm identity, bootstrap version, repository metadata, and publish command.
- `www/package.json`: private docs workspace dependency on the root package.
- `pnpm-lock.yaml`: generated workspace dependency key for `trakoo`.
- `.changeset/config.json`: GitHub repository used by generated changelog links.
- `.changeset/fix-cjs-exports.md`: pending change already included in the bootstrap and therefore consumed.
- `.github/workflows/release.yml`: Changesets release orchestration and OIDC permissions/toolchain.
- `readme.md`, `src/**/*.ts`, `test/**/*.ts`, `e2e/**/*.js`, `www/app/**/*.tsx`, `www/content/**/*.mdx`: active package-name references.
- `CHANGELOG.md`: active heading for future `trakoo` releases; historical release entries remain intact.
- The approved design record under `docs/superpowers/specs`: kept aligned with the active `trakoo` identity.

---

### Task 1: Rename the Functional Package

**Files:**

- Modify: `package.json`
- Modify: `www/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.changeset/config.json`
- Delete: `.changeset/fix-cjs-exports.md`
- Modify: `CHANGELOG.md:1`
- Modify: `readme.md`
- Modify: `src/adapters/client/browser-analytics.ts`
- Modify: `src/adapters/server/server-analytics.ts`
- Modify: `src/client.ts`
- Modify: `src/server.ts`
- Modify: `test/client.test.ts`
- Modify: `test/providers.test.ts`
- Modify: `test/server.test.ts`
- Modify: `e2e/test-app/server.js`
- Modify: `e2e/visitors-test-app/server.js`
- Modify: active files under `www/app` and `www/content`

**Interfaces:**

- Consumes: the current working root package and its private docs workspace.
- Produces: a workspace whose publishable root is `trakoo@0.0.0`, whose active examples import `trakoo`, and whose future Changesets links target `multiplehats/trakoo`.

- [ ] **Step 1: Run the package-identity regression check and verify it fails**

Run:

```bash
node --input-type=module -e '
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const docs = JSON.parse(readFileSync("www/package.json", "utf8"));
const changesets = JSON.parse(readFileSync(".changeset/config.json", "utf8"));
assert.equal(pkg.name, "trakoo");
assert.equal(pkg.version, "0.0.0");
assert.equal(pkg.repository.url, "git+https://github.com/multiplehats/trakoo.git");
assert.equal(pkg.bugs.url, "https://github.com/multiplehats/trakoo/issues");
assert.equal(pkg.homepage, "https://github.com/multiplehats/trakoo#readme");
assert.equal(docs.dependencies.trakoo, "workspace:*");
assert.equal(changesets.changelog[1].repo, "multiplehats/trakoo");
'
```

Expected: FAIL on `pkg.name`, proving the check detects the current package identity.

- [ ] **Step 2: Change the root package identity and repository metadata**

Apply this patch to `package.json`:

```diff
-  "name": "@stacksee/analytics",
-  "version": "0.14.5",
+  "name": "trakoo",
+  "version": "0.0.0",
@@
   "repository": {
     "type": "git",
-    "url": "git+https://github.com/stackseehq/analytics.git"
+    "url": "git+https://github.com/multiplehats/trakoo.git"
   },
+  "bugs": {
+    "url": "https://github.com/multiplehats/trakoo/issues"
+  },
+  "homepage": "https://github.com/multiplehats/trakoo#readme",
```

Do not change `ci:publish` in this step; Task 2 owns the release-authentication change.

- [ ] **Step 3: Update Changesets and consume the bootstrap change**

Apply:

```diff
--- a/.changeset/config.json
+++ b/.changeset/config.json
@@
-      "repo": "stackseehq/analytics"
+      "repo": "multiplehats/trakoo"
```

Delete `.changeset/fix-cjs-exports.md`. Its fix is already in the code that will ship as `0.0.0`; leaving it would create a duplicate `0.0.1` release.

- [ ] **Step 4: Replace active package-name references**

Run this mechanical replacement, deliberately excluding historical changelogs and the approved design record:

```bash
rg -l '@stacksee/analytics' readme.md src test e2e www --glob '!CHANGELOG.md' | xargs perl -pi -e 's/\@stacksee\/analytics/trakoo/g'
```

Change only the first line of `CHANGELOG.md`:

```diff
-# @stacksee/analytics
+# trakoo
```

Do not rewrite old version entries or old GitHub commit links in `CHANGELOG.md` or `www/CHANGELOG.md`.

- [ ] **Step 5: Regenerate the workspace lockfile**

Run:

```bash
pnpm install --lockfile-only
```

Expected: `www/package.json` and the `www` importer in `pnpm-lock.yaml` use `trakoo: workspace:*` / `link:..`; no dependency remains keyed as `@stacksee/analytics`.

- [ ] **Step 6: Run the identity check and active-reference checks**

Run the exact Node.js assertion command from Step 1.

Expected: exit code 0.

Run:

```bash
rg -n '@stacksee/analytics|stackseehq/analytics' readme.md src test e2e www/package.json www/app www/content .changeset package.json pnpm-lock.yaml
```

Expected: no output and exit code 1 from `rg`, meaning no active old-name references remain.

Run:

```bash
test ! -e .changeset/fix-cjs-exports.md
```

Expected: exit code 0.

- [ ] **Step 7: Review and commit the package rename**

Run:

```bash
git diff --check
git diff -- package.json www/package.json pnpm-lock.yaml .changeset CHANGELOG.md readme.md src test e2e www/app www/content
git status --short
```

Expected: only the approved package migration, active-reference replacements, generated lockfile changes, and the already committed design/plan records are in scope.

Commit:

```bash
git add package.json www/package.json pnpm-lock.yaml .changeset CHANGELOG.md readme.md src test e2e www/app www/content
git commit -m "chore: rename package to trakoo"
```

---

### Task 2: Convert the Release Workflow to Trusted Publishing

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `package.json`

**Interfaces:**

- Consumes: `trakoo@0.0.0` metadata and the existing `pnpm ci:publish` Changesets interface.
- Produces: a GitHub-hosted release job that can request an npm OIDC credential and has no npm token fallback.

- [ ] **Step 1: Run the workflow regression check and verify it fails**

Run:

```bash
node --input-type=module -e '
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.match(workflow, /^\s*id-token:\s*write\s*$/m);
assert.match(workflow, /^\s*node-version:\s*24\s*$/m);
assert.match(workflow, /^\s*package-manager-cache:\s*false\s*$/m);
assert.doesNotMatch(workflow, /^\s*registry-url:/m);
assert.doesNotMatch(workflow, /^\s*cache:\s*pnpm\s*$/m);
assert.doesNotMatch(workflow, /^\s*packages:\s*write\s*$/m);
assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);
assert.equal(pkg.scripts["ci:publish"], "pnpm build && changeset publish");
'
```

Expected: FAIL on the Node 24 assertion, proving the legacy workflow is detected.

- [ ] **Step 2: Replace the release workflow with the proven `wc-now` OIDC shape**

Set `.github/workflows/release.yml` to exactly:

```yaml
name: Release

on:
  push:
    branches:
      - main
      - next

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write
  id-token: write

jobs:
  release:
    name: Release
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          package-manager-cache: false

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --prefer-offline

      - name: Create Release Pull Request or Publish to npm
        id: changesets
        uses: changesets/action@v1
        with:
          commit: "chore(release): version package"
          title: "chore(release): version package"
          publish: pnpm ci:publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Do not add `registry-url`; the resulting token configuration prevents npm from selecting OIDC in this setup.

- [ ] **Step 3: Let Trusted Publishing generate provenance automatically**

Apply to `package.json`:

```diff
-    "ci:publish": "pnpm build && changeset publish --provenance",
+    "ci:publish": "pnpm build && changeset publish",
```

- [ ] **Step 4: Run the workflow regression check and formatting check**

Run the exact Node.js assertion command from Step 1.

Expected: exit code 0.

Run:

```bash
pnpm exec prettier --check .github/workflows/release.yml
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 5: Review and commit the OIDC workflow**

Run:

```bash
git diff --check
git diff -- .github/workflows/release.yml package.json
git status --short
```

Expected: the workflow diff matches the static assertions and `package.json` only removes the explicit provenance flag in this task.

Commit:

```bash
git add .github/workflows/release.yml package.json
git commit -m "ci: use npm trusted publishing"
```

---

### Task 3: Verify and Publish `trakoo@0.0.0`

**Files:**

- Verify: the complete workspace and generated npm tarball
- External write: npm registry package `trakoo@0.0.0`

**Interfaces:**

- Consumes: the committed `trakoo@0.0.0` package and locally authenticated npm CLI.
- Produces: immutable public registry package `trakoo@0.0.0`, owned by the explicitly confirmed personal npm account.

- [ ] **Step 1: Run the complete local verification suite**

Run each command independently and stop on the first failure:

```bash
pnpm install --frozen-lockfile --prefer-offline
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: every command exits 0. Existing non-fatal build warnings may remain, but `dist` must be generated.

- [ ] **Step 2: Inspect the exact bootstrap tarball**

Run:

```bash
npm pack --dry-run --json
```

Expected: one package with `name: "trakoo"`, `version: "0.0.0"`, and files limited by `package.json#files` to the built `dist`, README, license, and npm-required metadata. Stop if secrets, environment files, tests, source maps not intended for distribution, or unrelated workspace files appear.

- [ ] **Step 3: Recheck name availability immediately before authentication**

Run:

```bash
npm view trakoo --json
```

Expected: `E404 Not Found`. If package metadata is returned, stop; do not publish or select another name.

- [ ] **Step 4: Authenticate and confirm the npm owner**

Run interactively:

```bash
npm login
```

Then run:

```bash
npm whoami
```

Expected: a concrete npm username. Display it and pause for the user to explicitly confirm that this is the intended personal owner. Do not proceed based only on a guessed match to the GitHub username.

- [ ] **Step 5: Publish the immutable bootstrap package**

After explicit owner confirmation, run:

```bash
npm publish --access public
```

Expected: npm reports `+ trakoo@0.0.0`. If npm requests 2FA, allow the account owner to complete it interactively. If the result is ambiguous, do not retry before Step 6.

- [ ] **Step 6: Verify registry state before any retry or follow-up**

Run:

```bash
npm view trakoo@0.0.0 name version repository.url dist-tags.latest --json
```

Expected JSON values:

```json
{
  "name": "trakoo",
  "version": "0.0.0",
  "repository.url": "git+https://github.com/multiplehats/trakoo.git",
  "dist-tags.latest": "0.0.0"
}
```

Treat this registry response as authoritative even if the preceding publish command lost its final output.

---

### Task 4: Transfer and Rename the GitHub Repository

**Files:**

- External move: `stackseehq/analytics` to `multiplehats/trakoo`
- Modify local Git configuration: `remote.origin.url`

**Interfaces:**

- Consumes: administrator access to `stackseehq/analytics`, an available `multiplehats/trakoo` destination, and the committed migration branch.
- Produces: public GitHub repository `multiplehats/trakoo` containing the migration commits and a local `origin` pointed at the canonical URL.

- [ ] **Step 1: Verify GitHub identity, source permission, and destination availability**

Run:

```bash
gh auth status
gh repo view stackseehq/analytics --json nameWithOwner,viewerPermission,visibility,url
gh repo view multiplehats/trakoo --json nameWithOwner,url
gh api --paginate repos/stackseehq/analytics/collaborators --jq '.[] | [.login, .permissions.admin, .permissions.push] | @tsv'
gh issue list --repo stackseehq/analytics --state all --limit 1000 --json number,title,assignees
```

Expected: authenticated as the intended GitHub user; source `viewerPermission` is `ADMIN`; the destination lookup fails with not found. If the destination exists, stop before transferring.

Review the collaborator and issue-assignee output before continuing. An
organization-to-personal transfer does not retain read-only collaborators and
only retains issue assignments to the destination owner. Pause for explicit
confirmation if this output shows affected people or assignments.

- [ ] **Step 2: Transfer and rename the repository in one API request**

Run only after reviewing the exact source and destination:

```bash
gh api --include --method POST repos/stackseehq/analytics/transfer -f new_owner=multiplehats -f new_name=trakoo
```

Expected: HTTP `202 Accepted`. Do not repeat the transfer request if the destination is temporarily unavailable; GitHub may require acceptance or background processing.

- [ ] **Step 3: Complete any required transfer acceptance**

Check:

```bash
gh repo view multiplehats/trakoo --json nameWithOwner,url,visibility
```

Expected: `nameWithOwner` is `multiplehats/trakoo`. If GitHub sent an acceptance request instead, pause for the account owner to accept it, then rerun this read-only check.

- [ ] **Step 4: Update the canonical remote and push the migration commits**

Run:

```bash
git remote set-url origin https://github.com/multiplehats/trakoo.git
git remote -v
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
```

Expected: both fetch and push URLs are
`https://github.com/multiplehats/trakoo.git`; the ancestry check succeeds,
proving the fetched destination `main` is an ancestor of the current reviewed
`HEAD`; and the non-force push places that exact reviewed migration history on
destination `main`. If the ancestry check fails, stop and incorporate and
review the remote commits before retrying it.

- [ ] **Step 5: Verify repository identity and working-tree state**

Run:

```bash
gh repo view multiplehats/trakoo --json nameWithOwner,url,defaultBranchRef
git rev-parse HEAD
git ls-remote origin refs/heads/main
git status --short --branch
```

Expected: the repository is `multiplehats/trakoo`, its default branch is
`main`, the remote `main` SHA exactly matches the current reviewed `HEAD`, and
the current worktree has no uncommitted migration files. The original checkout
and its local `main` are out of scope for this worktree-safe procedure and must
be preserved if they are dirty.

Do not recreate a repository at `stackseehq/analytics`; GitHub uses that old location to redirect existing links and Git operations.

---

### Task 5: Bind npm Trusted Publishing to `multiplehats/trakoo`

**Files:**

- External configuration: npm package `trakoo` Trusted Publisher settings
- Verify: `.github/workflows/release.yml` on `multiplehats/trakoo@main`

**Interfaces:**

- Consumes: published `trakoo`, pushed `multiplehats/trakoo`, and workflow filename `release.yml` with `id-token: write`.
- Produces: npm trust policy allowing only the specified GitHub Actions workflow to call `npm publish` through OIDC.

- [ ] **Step 1: Confirm the workflow exists at the trusted repository**

Run:

```bash
gh api repos/multiplehats/trakoo/contents/.github/workflows/release.yml --jq '.name + " " + .sha'
```

Expected: `.github/workflows/release.yml` metadata with a non-empty blob SHA.

- [ ] **Step 2: Configure the npm Trusted Publisher**

In npmjs.com, open `trakoo` → **Settings** → **Trusted publishing**, choose **GitHub Actions**, and enter exactly:

```text
Organization or user: multiplehats
Repository: trakoo
Workflow filename: release.yml
Environment name: [empty]
Allowed actions: npm publish
```

Save the publisher. These fields are case-sensitive and the workflow filename contains only the filename, not `.github/workflows/`.

- [ ] **Step 3: Verify the saved trust configuration visually**

Expected: the `trakoo` settings page displays GitHub Actions bound to `multiplehats/trakoo`, workflow `release.yml`, allowed action `npm publish`, and no environment. If any field differs, edit it before relying on CI.

- [ ] **Step 4: Verify the repository workflow has no token fallback**

Run:

```bash
gh api repos/multiplehats/trakoo/contents/.github/workflows/release.yml --jq .content | base64 --decode | rg 'id-token: write|node-version: 24|NPM_TOKEN|NODE_AUTH_TOKEN|registry-url|packages: write'
```

Expected output contains only:

```text
  id-token: write
          node-version: 24
```

- [ ] **Step 5: Record the deferred end-to-end validation gate**

No synthetic release is created solely to exercise OIDC. On the first genuine post-bootstrap Changesets release, verify the Release workflow log reports that OIDC/Trusted Publishing is used, the npm publish succeeds, and npm displays provenance linked to `multiplehats/trakoo/.github/workflows/release.yml`.

Only after that successful release may the dormant GitHub `NPM_TOKEN` secret be deleted and npm token publishing optionally be disallowed. Until then, the secret remains stored but is not referenced by the workflow.

---

## Final Verification Checklist

- [ ] `npm view trakoo@0.0.0` reports the functional public bootstrap package.
- [ ] `gh repo view multiplehats/trakoo` reports the transferred repository.
- [ ] Local `origin` points to `https://github.com/multiplehats/trakoo.git`.
- [ ] Active source, tests, docs, and workspace metadata contain no `@stacksee/analytics` references.
- [ ] Historical changelog entries remain intact.
- [ ] `release.yml` uses Node 24 and `id-token: write` with no npm token or `registry-url`.
- [ ] npm shows the exact Trusted Publisher configuration for `multiplehats/trakoo` and `release.yml`.
- [ ] The old npm package is neither deprecated nor unpublished.
