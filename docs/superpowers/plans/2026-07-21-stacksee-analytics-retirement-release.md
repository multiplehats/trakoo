# `@stacksee/analytics` Retirement Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a final functional `@stacksee/analytics@0.14.6` with a minimal Trakoo migration README and an actionable deprecation warning, without changing Trakoo's package contents on `main`.

**Architecture:** Keep the retirement artifact isolated on a short-lived branch and worktree created from the immutable `@stacksee/analytics@0.14.5` tag. Review and verify that legacy artifact, publish and deprecate it exactly once, push an annotated source tag, then remove the temporary branch and worktree without merging them into `main`.

**Tech Stack:** Git worktrees and annotated tags, pnpm 9, TypeScript, Vite, Vitest, npm registry CLI.

## Global Constraints

- The maintained package remains exactly `trakoo`; do not alter its README, version, source, or release workflow to create the legacy release.
- The retirement package name is exactly `@stacksee/analytics` and its final version is exactly `0.14.6`.
- Start the retirement branch from the existing annotated `@stacksee/analytics@0.14.5` tag.
- The final legacy package must remain functional; do not publish an empty or intentionally broken tombstone.
- Replace the legacy README with only the approved migration notice.
- Point the legacy package repository URL directly to `git+https://github.com/multiplehats/trakoo.git`.
- Deprecate `@stacksee/analytics@*` with the exact approved migration message after publishing `0.14.6`.
- Do not unpublish any package version and do not create another `trakoo` release.
- If an npm publish result is ambiguous, query the registry before retrying; never publish blindly twice.
- Preserve the retirement source with an annotated `@stacksee/analytics@0.14.6` Git tag, but never merge its commit into `main`.

---

## File Structure

The implementation uses two isolated checkouts:

- Maintained checkout on `main`:
  - `docs/superpowers/specs/2026-07-21-stacksee-analytics-retirement-release-design.md` — approved design and policy.
  - `docs/superpowers/plans/2026-07-21-stacksee-analytics-retirement-release.md` — this execution plan.
- Temporary legacy worktree on `chore/stacksee-analytics-retirement`:
  - `package.json` — legacy name retained, version changed to `0.14.6`, repository redirected to Trakoo.
  - `readme.md` — replaced by the approved migration-only notice.

No other tracked legacy file should change.

---

### Task 1: Record the Plan and Create the Isolated Legacy Worktree

**Files:**

- Verify: `docs/superpowers/specs/2026-07-21-stacksee-analytics-retirement-release-design.md`
- Verify: `docs/superpowers/plans/2026-07-21-stacksee-analytics-retirement-release.md`
- Create worktree: `.worktrees/stacksee-analytics-retirement`
- Create branch: `chore/stacksee-analytics-retirement`

**Interfaces:**

- Consumes: clean `main`, the approved design and plan, and annotated tag `@stacksee/analytics@0.14.5`.
- Produces: an isolated clean checkout whose `HEAD` is based directly on the legacy `0.14.5` release source.

- [ ] **Step 1: Verify and publish the planning record on maintained `main`**

Run from `/Users/chris/dev/oss/analytics`:

```bash
git status --short --branch
git log -2 --oneline
git diff --check origin/main..HEAD
git push origin main
```

Expected: `main` is clean; the design and plan commits are present; the push is a fast-forward; no legacy package file is changed on `main`.

- [ ] **Step 2: Verify the source tag and destination names before creating anything**

Run:

```bash
git cat-file -t '@stacksee/analytics@0.14.5'
git rev-parse '@stacksee/analytics@0.14.5^{}'
git show-ref --verify --quiet refs/heads/chore/stacksee-analytics-retirement
git show-ref --verify --quiet 'refs/tags/@stacksee/analytics@0.14.6'
git ls-remote --exit-code --tags origin 'refs/tags/@stacksee/analytics@0.14.6'
npm view '@stacksee/analytics@0.14.6' version --json
```

Expected:

- the source object type is `tag` and dereferences to a commit;
- the local branch check exits 1;
- both local and remote `0.14.6` tag checks exit 1;
- npm returns `E404 Not Found` for `0.14.6`.

Stop if any destination already exists. Do not overwrite a branch, tag, or npm version.

- [ ] **Step 3: Create the isolated worktree from the legacy tag**

Run:

```bash
git worktree add -b chore/stacksee-analytics-retirement .worktrees/stacksee-analytics-retirement '@stacksee/analytics@0.14.5^{}'
git -C .worktrees/stacksee-analytics-retirement status --short --branch
git -C .worktrees/stacksee-analytics-retirement log -1 --oneline
```

Expected: the new branch is clean and its starting commit is the commit referenced by `@stacksee/analytics@0.14.5`.

---

### Task 2: Build and Review the Functional Retirement Artifact

**Files:**

- Modify: `.worktrees/stacksee-analytics-retirement/package.json`
- Modify: `.worktrees/stacksee-analytics-retirement/readme.md`
- Verify: `.worktrees/stacksee-analytics-retirement/dist/**`

**Interfaces:**

- Consumes: the isolated `@stacksee/analytics@0.14.5` source checkout from Task 1.
- Produces: one reviewed commit containing only the `0.14.6` package metadata and migration README, plus a verified functional npm tarball.

- [ ] **Step 1: Add a failing identity-and-notice assertion before editing**

Run from `.worktrees/stacksee-analytics-retirement`:

```bash
node --input-type=module -e "import fs from 'node:fs'; const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); const readme=fs.readFileSync('readme.md','utf8'); if(pkg.name!=='@stacksee/analytics'||pkg.version!=='0.14.6'||pkg.repository?.url!=='git+https://github.com/multiplehats/trakoo.git') process.exit(1); const expected='# Moved to Trakoo\n\nThis package has moved to [trakoo](https://www.npmjs.com/package/trakoo).\n\n\`\`\`sh\nnpm uninstall @stacksee/analytics\nnpm install trakoo\n\`\`\`\n\nUpdate imports from \`@stacksee/analytics\` to \`trakoo\`.\n\nSource: https://github.com/multiplehats/trakoo\n'; if(readme!==expected) process.exit(1);"
```

Expected: exit 1 because the checkout is still `0.14.5` with the legacy README.

- [ ] **Step 2: Apply the minimal retirement metadata changes**

Edit `package.json` with `apply_patch` so only these values change:

```json
{
  "name": "@stacksee/analytics",
  "version": "0.14.6",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/multiplehats/trakoo.git"
  }
}
```

Replace `readme.md` in full with:

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

Do not edit source, exports, dependencies, lockfile, changelogs, workflows, or docs.

- [ ] **Step 3: Run the identity-and-notice assertion again**

Run the exact Node command from Step 1.

Expected: exit 0.

- [ ] **Step 4: Verify the tracked diff is exactly two files**

Run:

```bash
git status --short
git diff --stat
git diff -- package.json readme.md
git diff --name-only | sort
```

Expected name list:

```text
package.json
readme.md
```

- [ ] **Step 5: Run the complete legacy package verification suite**

Run each command independently and stop on the first failure:

```bash
CI=true pnpm install --frozen-lockfile --prefer-offline
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: every command exits 0 and `dist` is generated. Existing non-fatal build warnings are allowed.

- [ ] **Step 6: Inspect and assert the exact npm tarball**

Run:

```bash
npm pack --dry-run --json
```

Expected:

- name `@stacksee/analytics`;
- version `0.14.6`;
- the README is `readme.md` and contains only the approved notice;
- package contents remain limited to `LICENSE`, `package.json`, `readme.md`, and built `dist/**` artifacts;
- no tests, source tree, environment file, credential, or unrelated workspace file is included.

- [ ] **Step 7: Commit the isolated retirement artifact**

Run:

```bash
git diff --check
git add package.json readme.md
git commit -m "chore: retire stacksee analytics package"
git status --short --branch
```

Expected: one clean commit and a clean branch. Record its full SHA for Task 3 review and tagging.

---

### Task 3: Publish, Deprecate, and Tag the Legacy Package

**Files:**

- External write: npm package `@stacksee/analytics@0.14.6`
- External write: npm deprecation range `@stacksee/analytics@*`
- External write: Git tag `@stacksee/analytics@0.14.6`
- Verify: the committed Task 2 artifact and public registry metadata

**Interfaces:**

- Consumes: the reviewed clean Task 2 commit, npm ownership, and GitHub push access.
- Produces: an immutable functional retirement release, actionable warnings on every legacy version, and a pushed source tag.

- [ ] **Step 1: Independently review the exact release commit and rerun safety checks**

Review the Task 2 commit against this plan before any external write. Then run:

```bash
git status --short --branch
git diff '@stacksee/analytics@0.14.5^{}'..HEAD --name-only
node --input-type=module -e "import fs from 'node:fs'; const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); if(pkg.name!=='@stacksee/analytics'||pkg.version!=='0.14.6'||pkg.repository?.url!=='git+https://github.com/multiplehats/trakoo.git') process.exit(1);"
npm pack --dry-run --json
```

Expected: clean branch, only `package.json` and `readme.md` differ from the prior tag, exact identity metadata, and the reviewed safe tarball.

- [ ] **Step 2: Recheck npm version availability and authenticated owner**

Run immediately before publication:

```bash
npm view '@stacksee/analytics@0.14.6' version --json
npm whoami
```

Expected: the version query returns E404 and `npm whoami` returns the explicitly confirmed intended owner. Pause for owner confirmation if the identity has not already been confirmed in this execution.

- [ ] **Step 3: Create the local annotated source tag**

Run:

```bash
git tag -a '@stacksee/analytics@0.14.6' -m '@stacksee/analytics@0.14.6'
git cat-file -t '@stacksee/analytics@0.14.6'
git rev-parse HEAD '@stacksee/analytics@0.14.6^{}'
```

Expected: object type `tag`; both dereferenced commit SHAs equal the reviewed Task 2 commit. Do not push the tag until npm publication and deprecation both verify successfully.

- [ ] **Step 4: Publish the final functional legacy version exactly once**

Run:

```bash
npm publish --access public
```

Expected: npm reports `+ @stacksee/analytics@0.14.6`. Complete browser authorization or 2FA interactively if required. If output is missing or ambiguous, do not retry before running Step 5.

- [ ] **Step 5: Verify the immutable version before any possible retry**

Run:

```bash
npm view '@stacksee/analytics@0.14.6' name version repository.url dist-tags.latest readme --json
```

Expected:

- name `@stacksee/analytics`;
- version and `latest` both `0.14.6`;
- repository URL `git+https://github.com/multiplehats/trakoo.git`;
- README exactly matches the approved migration notice and contains no legacy documentation.

Treat a matching registry response as authoritative even if Step 4 lost its final output.

- [ ] **Step 6: Replace the generic deprecation with the actionable migration message**

Run exactly:

```bash
npm deprecate '@stacksee/analytics@*' 'This package has moved to trakoo. Install `trakoo` instead: https://www.npmjs.com/package/trakoo'
```

Expected: exit 0. This changes the warning only; it does not unpublish any version.

- [ ] **Step 7: Verify the deprecation across the complete legacy version set**

Run:

```bash
npm view '@stacksee/analytics' version versions deprecated dist-tags.latest --json
npm view '@stacksee/analytics@0.14.5' deprecated --json
npm view '@stacksee/analytics@0.14.6' deprecated --json
```

Expected: `latest` is `0.14.6`; both sampled old and new versions return the exact approved deprecation message; the full versions list still contains every historical version.

- [ ] **Step 8: Push and verify the annotated release tag**

Run:

```bash
git push origin 'refs/tags/@stacksee/analytics@0.14.6'
git ls-remote --tags origin 'refs/tags/@stacksee/analytics@0.14.6' 'refs/tags/@stacksee/analytics@0.14.6^{}'
```

Expected: the remote annotated tag and its peeled commit exist; the peeled SHA equals the reviewed Task 2 commit.

- [ ] **Step 9: Prove the maintained Trakoo package was not changed**

Run:

```bash
npm view 'trakoo@0.0.0' name version repository.url dist-tags.latest --json
git ls-remote origin refs/heads/main
```

Expected: Trakoo remains exactly `0.0.0` with repository `multiplehats/trakoo`; remote `main` remains on the maintained planning commit and does not point to the legacy retirement commit.

---

### Task 4: Final Review and Cleanup

**Files:**

- Remove worktree: `.worktrees/stacksee-analytics-retirement`
- Delete local branch: `chore/stacksee-analytics-retirement`
- Preserve remote tag: `@stacksee/analytics@0.14.6`

**Interfaces:**

- Consumes: verified npm registry state and a verified pushed annotated tag.
- Produces: a clean maintained checkout with no temporary branch/worktree and an auditable immutable retirement release.

- [ ] **Step 1: Run the final independent release-state review**

Confirm all of the following from fresh read-only commands:

```bash
npm view '@stacksee/analytics@0.14.6' name version repository.url deprecated dist-tags.latest readme --json
npm view 'trakoo@0.0.0' name version repository.url dist-tags.latest --json
git ls-remote --tags origin 'refs/tags/@stacksee/analytics@0.14.6' 'refs/tags/@stacksee/analytics@0.14.6^{}'
git ls-remote origin refs/heads/main
```

Expected: every value matches Task 3, the migration README is exact, and the legacy commit is reachable from its tag rather than `main`.

- [ ] **Step 2: Remove the temporary worktree from the maintained checkout**

Run from `/Users/chris/dev/oss/analytics`, never from inside the worktree:

```bash
git worktree remove /Users/chris/dev/oss/analytics/.worktrees/stacksee-analytics-retirement
git worktree prune
```

Expected: the temporary path and worktree registration are removed. The committed source remains recoverable through the pushed annotated tag.

- [ ] **Step 3: Delete the fully tagged local branch**

Run:

```bash
git branch -D chore/stacksee-analytics-retirement
git worktree list
git branch --list chore/stacksee-analytics-retirement
git status --short --branch
```

Expected: the local branch is absent, only intended worktrees remain, and maintained `main` is clean and aligned with `origin/main`.

The force-delete is intentional because the retirement commit must not be merged into `main`; its exact source is preserved by the verified remote annotated tag.

---

## Final Verification Checklist

- [ ] `@stacksee/analytics@0.14.6` is public, functional, and `latest` for the legacy package.
- [ ] The old npm page shows only the approved Trakoo migration README.
- [ ] Every legacy version carries the actionable Trakoo deprecation warning.
- [ ] The legacy package repository metadata points directly to `multiplehats/trakoo`.
- [ ] The annotated `@stacksee/analytics@0.14.6` tag peels to the reviewed retirement commit.
- [ ] `trakoo@0.0.0` and maintained `main` remain unchanged by the retirement artifact.
- [ ] No legacy retirement branch or worktree remains locally.
