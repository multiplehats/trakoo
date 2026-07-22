# Trakoo Agent Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and validate an installable consumer-facing Trakoo Agent Skill with concise core guidance and on-demand provider and framework references.

**Architecture:** Place one discoverable skill at `skills/trakoo/SKILL.md`; keep provider and framework detail in two references that are loaded only when relevant. Protect the package with a Vitest contract test, document installation in the root README, and compare realistic agent outputs with and without the skill before considering it complete.

**Tech Stack:** Agent Skills open specification, Markdown/YAML frontmatter, skills CLI, TypeScript, Vitest, pnpm.

## Global Constraints

- The skill serves applications consuming Trakoo, not contributors changing Trakoo internals.
- The install command is exactly `npx skills add multiplehats/trakoo --skill trakoo`.
- The core skill must use public exports from `trakoo`, `trakoo/client`, `trakoo/server`, `trakoo/providers/client`, and `trakoo/providers/server` only.
- Keep browser providers and public environment values separate from server providers and secrets.
- Cover Next.js, SvelteKit, TanStack Start, Astro, and framework-neutral TypeScript.
- Do not add runtime dependencies to the Trakoo package.
- Treat installed package declarations as authoritative when a consumer's installed version differs from current repository docs.
- Keep generated evaluation outputs under `.context/`; do not commit them.

## File Map

- Create `skills/trakoo/SKILL.md`: discovery metadata, core integration workflow, invariants, one end-to-end example, and verification.
- Create `skills/trakoo/references/providers.md`: provider selection, optional dependencies, constraints, routing, Proxy, and custom providers.
- Create `skills/trakoo/references/frameworks.md`: framework detection, file placement, environment boundaries, navigation tracking, and server lifecycle.
- Create `test/agent-skill.test.ts`: repository-level contract for discovery metadata, required guidance, references, framework coverage, and README installation copy.
- Modify `readme.md`: short Agent Skill installation section.
- Create `.context/trakoo-skill-evals/evals/evals.json`: local evaluation prompts and assertions; this remains gitignored.

---

### Task 1: Capture baseline agent behavior

**Files:**
- Create (gitignored): `.context/trakoo-skill-evals/evals/evals.json`
- Create (gitignored): `.context/trakoo-skill-evals/iteration-1/*/without_skill/outputs/response.md`

**Interfaces:**
- Consumes: Current public Trakoo source and documentation; no skill guidance.
- Produces: Three baseline responses and a stable assertion set used by Task 6.

- [ ] **Step 1: Create the evaluation set before authoring the skill**

Write `.context/trakoo-skill-evals/evals/evals.json` with this exact structure:

```json
{
  "skill_name": "trakoo",
  "evals": [
    {
      "id": 1,
      "name": "typed-vite-posthog",
      "prompt": "I have a Vite React TypeScript app using pnpm. Add Trakoo with PostHog browser analytics. Define typed signup and CTA-click events, identify after login, reset after logout, and tell me how to verify it. Return the exact files and commands you would use.",
      "expected_output": "Uses pnpm, posthog-js, a central as-const-satisfies event collection, trakoo/client and trakoo/providers/client, AppEvents on the factory, client-safe VITE_ values, identify/reset lifecycle, and typecheck verification.",
      "files": [],
      "assertions": [
        "Installs trakoo and posthog-js with pnpm",
        "Defines a central typed event collection with as const satisfies",
        "Uses trakoo/client and trakoo/providers/client imports",
        "Passes AppEvents to createClientAnalytics",
        "Uses only client-public environment values",
        "Calls identify after login and reset after logout",
        "Includes a typecheck or build verification command"
      ]
    },
    {
      "id": 2,
      "name": "nextjs-critical-server-event",
      "prompt": "In a Next.js TypeScript app, use Trakoo and PostHog to record a subscription purchase on the server. The browser must never receive the PostHog secret. Include typed events, user context, error-safe flushing, and exact imports. Return the files you would add.",
      "expected_output": "Uses posthog-node and server-only imports, shares the event type safely, awaits tracking, passes user context, and shuts down in finally without leaking the secret.",
      "files": [],
      "assertions": [
        "Uses trakoo/server and trakoo/providers/server imports",
        "Installs or names posthog-node rather than posthog-js for server delivery",
        "Keeps the provider key in an unprefixed server environment variable",
        "Passes AppEvents to createServerAnalytics",
        "Awaits the purchase tracking call",
        "Passes explicit user context",
        "Calls shutdown in a finally block"
      ]
    },
    {
      "id": 3,
      "name": "routed-bento-pirsch",
      "prompt": "Configure Trakoo for a SaaS app that wants anonymous privacy-friendly page views in Pirsch and identified lifecycle events in Bento. Explain the client/server split, required packages, provider routing, and the important delivery constraints. Include a minimal configuration.",
      "expected_output": "Routes page views away from Bento, requires email identification for Bento, describes Pirsch request context for server hits, and does not invent SDK dependencies.",
      "files": [],
      "assertions": [
        "States that Bento requires identified users with email",
        "Routes or excludes pageView from Bento",
        "States that Pirsch server events need request IP and User-Agent context",
        "Names @bentonow/bento-node-sdk only for Bento server usage",
        "Does not require an extra Pirsch package",
        "Uses valid client or server provider aggregate imports"
      ]
    }
  ]
}
```

- [ ] **Step 2: Run all three baseline prompts in fresh contexts without the skill**

Dispatch one fresh subagent per evaluation. Each evaluator acts as an application developer working in a consuming repository, which models using the skill outside the Trakoo library repository. Give the evaluator only its exact evaluation prompt. The evaluator MUST NOT read this Trakoo repository's source, tests, README, documentation, existing plan or design specification, future skill files, or internet sources. It must answer from its existing knowledge without the Trakoo skill and save only its final response under:

```text
.context/trakoo-skill-evals/iteration-1/<eval-name>/without_skill/outputs/response.md
```

Expected: Three response files exist. Grade each answer honestly against the objective assertions without instructing evaluators to omit information or otherwise degrade their answers. The RED gate passes only if at least one assertion genuinely fails. Record exact misses in each evaluation directory's `baseline-findings.md`.

For each evaluation directory, also write `eval_metadata.json` with `eval_id`, `eval_name`, the exact prompt, and its assertion array from `evals.json`. When each subagent completes, immediately save the notification's token and duration values to `without_skill/timing.json`:

```json
{
  "total_tokens": 0,
  "duration_ms": 0,
  "total_duration_seconds": 0
}
```

Replace each zero with the actual completion values; zeros are invalid final timing data.

- [ ] **Step 3: Confirm no tracked files were created**

Run: `git status --short`

Expected: No `.context/` paths appear.

---

### Task 2: Add the discoverable core skill

**Files:**
- Create: `test/agent-skill.test.ts`
- Create: `skills/trakoo/SKILL.md`

**Interfaces:**
- Consumes: Public Trakoo types and factories plus the provider/framework references created in later tasks.
- Produces: Skill `trakoo` and contract-test helpers reused by Tasks 3–5.

- [ ] **Step 1: Write the failing discovery and core-guidance tests**

Create `test/agent-skill.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
	readFileSync(
		fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
		"utf8",
	);

describe("Trakoo Agent Skill", () => {
	it("has discoverable metadata and core integration rules", () => {
		const skill = read("skills/trakoo/SKILL.md");

		expect(skill).toMatch(/^---\nname: trakoo\ndescription: Use when /);
		expect(skill).toContain("trakoo/client");
		expect(skill).toContain("trakoo/server");
		expect(skill).toContain("trakoo/providers/client");
		expect(skill).toContain("trakoo/providers/server");
		expect(skill).toContain("as const satisfies");
		expect(skill).toContain("createClientAnalytics<AppEvents>");
		expect(skill).toContain("createServerAnalytics<AppEvents>");
		expect(skill).toContain("shutdown()");
		expect(skill).toContain("references/providers.md");
		expect(skill).toContain("references/frameworks.md");
	});
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run test/agent-skill.test.ts`

Expected: FAIL with `ENOENT` for `skills/trakoo/SKILL.md`.

- [ ] **Step 3: Write the minimal core skill**

Create `skills/trakoo/SKILL.md` with:

````markdown
---
name: trakoo
description: Use when adding, configuring, or troubleshooting Trakoo analytics in TypeScript applications, including typed events, browser or server tracking, PostHog, OpenPanel, Bento, Pirsch, EmitKit, Visitors, Proxy, provider routing, user identification, or framework integration.
---

# Trakoo Integration

Trakoo is a typed, provider-agnostic analytics library. Preserve its central event contract and its browser/server boundary; those two choices prevent most integration errors.

## Start by inspecting the application

Before editing, detect the package manager, framework, installed `trakoo` version, browser/server entry points, existing analytics dependencies, and available verification commands. Determine whether each requested event is a browser interaction, an authoritative server event, or both.

Use the consuming project's installed Trakoo declarations as the source of truth. If they differ from current official docs, explain the version mismatch; do not silently upgrade or invent an API.

Read [references/providers.md](references/providers.md) when choosing or configuring providers, routing events, using Proxy, or building a custom provider. Read only the matching section of [references/frameworks.md](references/frameworks.md) for Next.js, SvelteKit, TanStack Start, Astro, or framework-neutral integration.

## Integration workflow

1. Install `trakoo` with the project's package manager, plus only the selected providers' optional SDKs.
2. Define the event collection before adding tracking calls.
3. Put browser and server analytics in separate modules with environment-specific imports.
4. Add tracking where the event becomes true: interactions in browser handlers; payments, signups, jobs, and other authoritative outcomes on the server.
5. Apply identity and delivery lifecycle rules.
6. Run the project's formatter, type checker, relevant tests, and build when it checks environment boundaries.

## Typed event contract

```ts
import type { CreateEventDefinition, EventCollection } from "trakoo";

export const appEvents = {
	ctaClicked: {
		name: "cta_clicked",
		category: "engagement",
		properties: {} as { location: "hero" | "pricing" },
	},
	purchaseCompleted: {
		name: "purchase_completed",
		category: "conversion",
		properties: {} as {
			orderId: string;
			amount: number;
			currency: string;
		},
	},
} as const satisfies EventCollection<
	Record<string, CreateEventDefinition<string>>
>;

export type AppEvents = typeof appEvents;
```

Object keys organize source code; each `name` is the stable value sent to providers. Keep names stable after release and type properties narrowly.

## Browser module

```ts
import { createClientAnalytics } from "trakoo/client";
import { PostHogClientProvider } from "trakoo/providers/client";
import type { AppEvents } from "./events";

export const analytics = createClientAnalytics<AppEvents>({
	providers: [
		new PostHogClientProvider({
			token: import.meta.env.VITE_POSTHOG_KEY,
		}),
	],
});
```

Create one browser instance per session. Call `analytics.identify(userId, traits)` after authentication and `analytics.reset()` on logout. Browser tracking is normally fire-and-forget; do not block navigation on non-critical analytics.

## Server module and critical event

```ts
import { createServerAnalytics } from "trakoo/server";
import { PostHogServerProvider } from "trakoo/providers/server";
import type { AppEvents } from "./events";

const analytics = createServerAnalytics<AppEvents>({
	providers: [
		new PostHogServerProvider({ apiKey: process.env.POSTHOG_API_KEY! }),
	],
});

try {
	await analytics.track(
		"purchase_completed",
		{ orderId, amount, currency },
		{ userId, user: { email } },
	);
} finally {
	await analytics.shutdown();
}
```

Server analytics is stateless across users: pass user context with each event. Await critical events. In serverless or other short-lived runtimes, call `shutdown()` before exit, preferably in `finally`; use the platform's `waitUntil` only for explicitly non-critical work.

## Import and lifecycle reference

| Concern | Correct pattern |
|---|---|
| Shared types | `trakoo` |
| Browser factory | `trakoo/client` |
| Server factory | `trakoo/server` |
| Browser providers | `trakoo/providers/client` |
| Server providers | `trakoo/providers/server` |
| Browser identity | `identify()` after login; `reset()` on logout |
| Server identity | Context on every call |
| Critical server delivery | Await `track()` and then `shutdown()` |

Never import a server provider, secret, or unprefixed server environment variable into browser code. Do not use a nonexistent `trakoo/providers` aggregate.

## Verification

Use the consuming project's commands. At minimum, run its type checker and the narrowest relevant tests; run its production build when client/server bundling or environment variables changed. Recheck installed declarations when an import, option, event property, or provider constructor fails.

## Common mistakes

- Tracking first and defining events later, which loses useful type pressure.
- Omitting `AppEvents` from an analytics factory.
- Sharing stateful browser identity logic with stateless server analytics.
- Sending every method and event to providers with different requirements instead of routing them.
- Installing all optional provider SDKs instead of only those selected.
- Forgetting logout reset, request user context, or short-lived-runtime shutdown.
````

- [ ] **Step 4: Run the focused test**

Run: `pnpm vitest run test/agent-skill.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the core skill**

```bash
git add test/agent-skill.test.ts skills/trakoo/SKILL.md
git commit -m "feat: add Trakoo agent skill"
```

---

### Task 3: Add provider reference guidance

**Files:**
- Modify: `test/agent-skill.test.ts`
- Create: `skills/trakoo/references/providers.md`

**Interfaces:**
- Consumes: The core skill's link to `references/providers.md`.
- Produces: Provider selection and advanced routing guidance.

- [ ] **Step 1: Add a failing provider-reference test**

Add this test inside the existing `describe` block:

```ts
	it("covers every public provider and its delivery constraints", () => {
		const providers = read("skills/trakoo/references/providers.md");

		for (const name of [
			"PostHog",
			"OpenPanel",
			"Bento",
			"Pirsch",
			"EmitKit",
			"Visitors",
			"Proxy",
			"BaseAnalyticsProvider",
		]) {
			expect(providers).toContain(name);
		}
		expect(providers).toContain("@bentonow/bento-node-sdk");
		expect(providers).toContain("IP address and User-Agent");
		expect(providers).toContain("methods");
		expect(providers).toContain("excludeEvents");
		expect(providers).toContain("eventPatterns");
	});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run test/agent-skill.test.ts`

Expected: FAIL with `ENOENT` for `references/providers.md`.

- [ ] **Step 3: Create the provider reference**

Create `skills/trakoo/references/providers.md` with these exact sections and facts:

````markdown
# Provider Reference

Read the selected provider's installed constructor types and official Trakoo provider page before generating final code. Install only dependencies required by the selected side.

## Capability and dependency matrix

| Provider | Browser | Server | Extra dependency | Use and constraints |
|---|---:|---:|---|---|
| PostHog | Yes | Yes | Browser: `posthog-js`; server: `posthog-node` | General product analytics. Keep the server key out of browser code. |
| OpenPanel | Yes | Yes | Browser: `@openpanel/web`; server: `@openpanel/sdk` | Product and web analytics across both runtimes. |
| Bento | Yes | Yes | Browser: none; server: `@bentonow/bento-node-sdk` | Identified lifecycle/email events. An email is required; route anonymous page views elsewhere. |
| Pirsch | Yes | Yes | None | Privacy-first analytics. Server hits require the visitor IP address and User-Agent request context. |
| EmitKit | No | Yes | `@emitkit/js` when required by the installed version | Server-side event notifications; verify its current constructor from installed types. |
| Visitors | Yes | No | None | Privacy-friendly web analytics. Identification needs persistence and appropriate consent; page views are automatic. |
| Proxy | Yes | Ingestion helpers | None | First-party batching from `ProxyProvider` to `createProxyHandler` or `ingestProxyEvents`. It is transport, not an analytics vendor. |

## Choose by event semantics

- Use browser providers for interaction, navigation, and other non-critical UI events.
- Use server providers for payments, confirmed signups, jobs, and events that must survive blockers or navigation.
- Pair providers when one handles anonymous measurement and another handles identified lifecycle automation.
- Use Proxy when keys must stay server-side, request context is required, or first-party delivery is important.

## Routing

Each provider entry can be a provider instance or a routing object:

```ts
providers: [
	new PostHogClientProvider({ token: publicPosthogKey }),
	{
		provider: new BentoClientProvider({ siteUuid: publicBentoSiteUuid }),
		methods: ["identify", "track"],
		eventPatterns: ["user_*", "subscription_*"],
	},
]
```

Use one method selector: `methods` or `exclude`. Use one event selector: `events`, `excludeEvents`, or `eventPatterns`. If mutually exclusive options are combined, Trakoo warns and applies precedence; remove the ambiguity instead of relying on precedence.

## Provider constraints

### Bento

Call client `identify()` with a valid email before sending Bento events. Exclude `pageView` or restrict Bento to `identify` and `track`; send anonymous traffic to PostHog, Pirsch, or another suitable provider.

### Pirsch

No extra package is required. A server event without the original IP address and User-Agent cannot be attributed and is skipped. Proxy browser events through a server endpoint when that request context is needed.

### Visitors

Visitors is browser-only. `pageView()` does not send a duplicate because its script tracks page loads automatically. Non-scalar custom properties are dropped. `identify()` requires persistence and, where applicable, explicit consent.

### Proxy

Import `ProxyProvider` from `trakoo/providers/client`; import `createProxyHandler` or `ingestProxyEvents` from `trakoo/providers/server`. Keep the endpoint same-origin when the goal is first-party delivery. Configure batch size and interval only when defaults do not meet the application's delivery needs.

## Custom providers

Extend `BaseAnalyticsProvider` from the environment-specific provider export and implement the `AnalyticsProvider` contract. Preserve Trakoo's event `action`, properties, and context; do not put vendor-specific behavior into shared event definitions.

## Verification

Typecheck constructor options against the installed provider types. Exercise one representative event per routing branch and confirm excluded events or methods do not reach that provider. For buffered server SDKs, verify the handler flushes before exit.
````

- [ ] **Step 4: Run the focused test and commit**

Run: `pnpm vitest run test/agent-skill.test.ts`

Expected: PASS.

```bash
git add test/agent-skill.test.ts skills/trakoo/references/providers.md
git commit -m "docs: add Trakoo provider skill reference"
```

---

### Task 4: Add framework integration guidance

**Files:**
- Modify: `test/agent-skill.test.ts`
- Create: `skills/trakoo/references/frameworks.md`

**Interfaces:**
- Consumes: The core skill's link to `references/frameworks.md`.
- Produces: Framework-specific browser/server boundary and navigation guidance.

- [ ] **Step 1: Add a failing framework-reference test**

Add this test inside the existing `describe` block:

```ts
	it("covers supported framework boundaries", () => {
		const frameworks = read("skills/trakoo/references/frameworks.md");

		for (const name of [
			"Next.js",
			"SvelteKit",
			"TanStack Start",
			"Astro",
			"Framework-neutral",
		]) {
			expect(frameworks).toContain(name);
		}
		expect(frameworks).toContain("router.subscribe(\"onResolved\"");
		expect(frameworks).toContain("astro:page-load");
		expect(frameworks).toContain("PUBLIC_");
		expect(frameworks).toContain("VITE_");
	});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run test/agent-skill.test.ts`

Expected: FAIL with `ENOENT` for `references/frameworks.md`.

- [ ] **Step 3: Create the framework reference**

Create `skills/trakoo/references/frameworks.md` with this structure and guidance:

````markdown
# Framework Integration Reference

Read only the section matching the consuming project. Framework APIs evolve; confirm routing hooks and server boundaries against the installed framework version before editing.

## Detection

| Signal | Framework |
|---|---|
| `next.config.*` plus `next` dependency | Next.js |
| `svelte.config.*` plus `@sveltejs/kit` | SvelteKit |
| `@tanstack/react-start` and its Vite/Rsbuild plugin | TanStack Start |
| `astro.config.*` plus `astro` | Astro |
| Browser entry plus server/API entry without the above | Framework-neutral TypeScript |

## Shared rules

- Keep `events.ts` environment-neutral and import only types from `trakoo`.
- Put `createClientAnalytics` and browser providers in a browser-only module.
- Put `createServerAnalytics`, server providers, and secrets in a server-only module.
- Track a business event where it becomes authoritative, not merely where navigation happens.
- Use the framework's public-variable convention only for browser-safe provider identifiers.

## Next.js

Use a client component for browser initialization, identity lifecycle, and navigation effects. Browser values use `NEXT_PUBLIC_*`; unprefixed values remain server-only. Put critical tracking in route handlers, server actions, or other server-only modules. Await critical events and call `shutdown()` in `finally` before a short-lived request exits. Verify with `next build` because it catches accidental server imports in client bundles.

## SvelteKit

Initialize browser analytics only in browser-executed code such as `onMount`; keep server providers in `+page.server.ts`, `+server.ts`, hooks, or other server-only modules. Use `$env/static/public` or `$env/dynamic/public` for client-safe values and private `$env/*/private` modules only on the server. Use the installed SvelteKit navigation API for page views and avoid double-counting the initial navigation.

## TanStack Start

Place browser analytics in client-executed application code and server analytics inside `createServerFn` handlers or server routes. With Vite, expose only browser-safe identifiers through `VITE_*`; keep secrets unprefixed and read them inside the per-request server handler, especially on edge runtimes. Subscribe to completed navigation for page views and clean up the subscription:

```ts
const unsubscribe = router.subscribe("onResolved", ({ toLocation }) => {
	analytics.pageView({ path: toLocation.pathname, url: toLocation.href });
});
```

Use the framework's lifecycle to call `unsubscribe()` when the owner is disposed.

## Astro

Initialize client analytics in a processed `<script>` or a hydrated UI-framework island. Use `PUBLIC_*`/`astro:env/client` only for browser-safe values and `astro:env/server` for server provider secrets. Put critical tracking in endpoints, actions, middleware, or other server-rendered code. With Astro's client router, listen for completed navigations:

```ts
document.addEventListener("astro:page-load", () => {
	analytics.pageView({ path: window.location.pathname, url: window.location.href });
});
```

Ensure a persistent script or guarded setup registers the listener once so client navigation does not multiply page views.

## Framework-neutral TypeScript

Create one browser singleton from the application's browser entry and one server factory or request-scoped instance from server code. Use the build tool's public environment prefix (`VITE_*` for Vite by default). Subscribe to the chosen router's completed-navigation event rather than click events, because redirects and history navigation also change pages.

## Verification

Run the framework's typecheck and production build. Confirm browser output contains no server provider import or secret name. Exercise initial load, client navigation, login, logout, and one critical server event; ensure each expected event is emitted once.
````

- [ ] **Step 4: Run the focused test and commit**

Run: `pnpm vitest run test/agent-skill.test.ts`

Expected: PASS.

```bash
git add test/agent-skill.test.ts skills/trakoo/references/frameworks.md
git commit -m "docs: add Trakoo framework skill reference"
```

---

### Task 5: Document skills.sh installation

**Files:**
- Modify: `test/agent-skill.test.ts`
- Modify: `readme.md`

**Interfaces:**
- Consumes: Installable skill name `trakoo`.
- Produces: Public installation and discovery instructions.

- [ ] **Step 1: Add a failing README contract test**

Add this test inside the existing `describe` block:

```ts
	it("documents skills CLI installation", () => {
		const readme = read("readme.md");

		expect(readme).toContain("## Agent Skill");
		expect(readme).toContain(
			"npx skills add multiplehats/trakoo --skill trakoo",
		);
		expect(readme).toContain("skills/trakoo/SKILL.md");
	});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run test/agent-skill.test.ts`

Expected: FAIL because the README does not contain `## Agent Skill`.

- [ ] **Step 3: Add the README section after Quick Links**

Add:

````markdown
## Agent Skill

Give your coding agent Trakoo-specific integration guidance for typed events, client/server boundaries, providers, and framework setup:

```bash
npx skills add multiplehats/trakoo --skill trakoo
```

The source is [`skills/trakoo/SKILL.md`](./skills/trakoo/SKILL.md) and follows the portable Agent Skills format used by skills.sh-compatible agents.
````

- [ ] **Step 4: Run the focused test and commit**

Run: `pnpm vitest run test/agent-skill.test.ts`

Expected: PASS.

```bash
git add test/agent-skill.test.ts readme.md
git commit -m "docs: document Trakoo agent skill installation"
```

---

### Task 6: Evaluate and refine the skill

**Files:**
- Read: `.context/trakoo-skill-evals/evals/evals.json`
- Create (gitignored): `.context/trakoo-skill-evals/iteration-1/*/with_skill/`
- Modify only if an assertion exposes a real gap: `skills/trakoo/SKILL.md`, `skills/trakoo/references/providers.md`, or `skills/trakoo/references/frameworks.md`

**Interfaces:**
- Consumes: Baseline prompts/assertions and completed skill package.
- Produces: With-skill responses, grading, benchmark, and human-review page.

- [ ] **Step 1: Run the same prompts in fresh contexts with the skill**

Dispatch one fresh subagent per evaluation with the corresponding prompt and the absolute path to `skills/trakoo/SKILL.md`. Save outputs under:

```text
.context/trakoo-skill-evals/iteration-1/<eval-name>/with_skill/outputs/response.md
```

Expected: Three with-skill responses exist.

As each run completes, immediately save its actual completion token and duration values to `with_skill/timing.json` using the same schema as Task 1.

- [ ] **Step 2: Grade each baseline and with-skill response**

Create `grading.json` beside each response using the exact assertion text from `evals.json` and objects shaped as:

```json
{
  "expectations": [
    {
      "text": "Assertion text",
      "passed": true,
      "evidence": "Exact file and excerpt or concise explanation"
    }
  ]
}
```

Expected: Every assertion has evidence; no score is based on writing style alone.

- [ ] **Step 3: Aggregate and inspect the benchmark**

Run from `/Users/chris/.agents/skills/skill-creator`:

```bash
python -m scripts.aggregate_benchmark \
  /Users/chris/conductor/workspaces/trakoo/ottawa/.context/trakoo-skill-evals/iteration-1 \
  --skill-name trakoo
```

Expected: `benchmark.json` and `benchmark.md` are created. Review for assertions that pass equally without the skill and for any correctness regression.

- [ ] **Step 4: Generate the review UI**

Run:

```bash
nohup python /Users/chris/.agents/skills/skill-creator/eval-viewer/generate_review.py \
  /Users/chris/conductor/workspaces/trakoo/ottawa/.context/trakoo-skill-evals/iteration-1 \
  --skill-name trakoo \
  --benchmark /Users/chris/conductor/workspaces/trakoo/ottawa/.context/trakoo-skill-evals/iteration-1/benchmark.json \
  > /dev/null 2>&1 &
TRAKOO_VIEWER_PID=$!
```

Expected: The review viewer opens with Outputs and Benchmark tabs. Ask the user to review before revising subjective content.

- [ ] **Step 5: Apply evidence-based refinements only**

For each failed objective assertion, identify whether the missing guidance belongs in the core workflow, provider reference, or framework reference. Add the smallest positive instruction or example that closes that specific gap; rerun the focused contract test and the affected evaluation. Do not add generic prohibitions or duplicate an existing reference.

- [ ] **Step 6: Commit any refinement**

If tracked files changed:

```bash
git add skills/trakoo test/agent-skill.test.ts
git commit -m "docs: refine Trakoo agent skill guidance"
```

Expected: Commit is skipped when evaluation reveals no tracked-file gap.

---

### Task 7: Verify repository and skills CLI compatibility

**Files:**
- Verify: `skills/trakoo/SKILL.md`
- Verify: `skills/trakoo/references/providers.md`
- Verify: `skills/trakoo/references/frameworks.md`
- Verify: `test/agent-skill.test.ts`
- Verify: `readme.md`

**Interfaces:**
- Consumes: Final tracked implementation.
- Produces: Completion evidence.

- [ ] **Step 1: Run focused and full repository checks**

```bash
pnpm vitest run test/agent-skill.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

Expected: All commands exit 0 with no new warnings.

- [ ] **Step 2: Validate formatting**

Run: `pnpm biome check test/agent-skill.test.ts`

Expected: Exit 0. Markdown is manually checked with `git diff --check` because the repository's Biome configuration does not own skill prose.

- [ ] **Step 3: Validate skills CLI discovery without installing globally**

Run: `npx skills add . --list`

Expected: The output lists the `trakoo` skill discovered from `skills/trakoo/SKILL.md`. If the current CLI uses a renamed read-only listing flag, inspect `npx skills add --help` and use its documented equivalent without writing into an agent directory.

- [ ] **Step 4: Inspect final diff and status**

```bash
git diff origin/main...HEAD --check
git diff origin/main...HEAD --stat
git status --short
```

Expected: No whitespace errors; only the design/plan commits and intended skill, test, and README changes are present; `.context/` evaluation artifacts remain untracked and hidden.
