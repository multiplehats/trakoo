---
name: trakoo
description: Use when adding, configuring, or troubleshooting Trakoo analytics in TypeScript applications, including typed or validated events, browser or server tracking, PostHog, OpenPanel, Bento, Pirsch, EmitKit, Visitors, Proxy, provider routing, user identification, or framework integration.
---

# Trakoo Integration

Trakoo is a typed, provider-agnostic analytics library. Define one runtime event registry, pass it to every analytics factory, and preserve the browser/server boundary.

## Inspect the application first

Detect the package manager, framework, installed `trakoo` version, browser/server entry points, analytics dependencies, and verification commands. Decide whether each event is a browser interaction, an authoritative server outcome, or both.

Use the consuming project's installed Trakoo declarations as the source of truth. Consult the current documentation at https://trakoo.co. If the installed declarations differ, explain the version mismatch instead of silently upgrading or inventing an API.

- Read [references/events-and-validation.md](references/events-and-validation.md) when defining events, adding Zod or another Standard Schema validator, configuring validation failures, or using propertyless events and custom traits.
- Read [references/providers.md](references/providers.md) when choosing providers, routing events, using Proxy, or building a custom provider.
- Read only the matching section of [references/frameworks.md](references/frameworks.md) for Next.js, SvelteKit, TanStack Start, Astro, or framework-neutral integration.

## Integration workflow

1. Install `trakoo`, the selected providers' optional SDKs, and a validator only when runtime validation is wanted.
2. Define and export one shared registry with `defineEvents()`.
3. Put client and server analytics in separate modules and pass `events: appEvents` to each factory.
4. Track where the event becomes true: interactions in browser handlers; payments, signups, jobs, and other authoritative outcomes on the server.
5. Apply identity, validation, and delivery lifecycle rules.
6. Run the consuming project's formatter, type checker, relevant tests, and production build.

## Shared event registry

Root helpers are environment-neutral and safe to import from shared code:

```ts
import { defineEvents, noProperties, typed } from "trakoo";

export const appEvents = defineEvents({
	ctaClicked: {
		name: "cta_clicked",
		category: "engagement",
		properties: typed<{ location: "hero" | "pricing" }>(),
	},
	purchaseCompleted: {
		name: "purchase_completed",
		category: "conversion",
		properties: typed<{
			orderId: string;
			amount: number;
			currency: string;
		}>(),
	},
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
	},
});
```

Registry keys organize application source; each `name` is the stable value emitted to providers. Use a Standard Schema-compatible validator directly for runtime validation and transformation. See the event reference for a complete Zod example.

## Browser module

```ts
import { typed } from "trakoo";
import { createClientAnalytics } from "trakoo/client";
import { PostHogClientProvider } from "trakoo/providers/client";
import { appEvents } from "./events";

interface BrowserUserTraits {
	email: string;
	plan: "free" | "pro";
}

export const analytics = createClientAnalytics({
	events: appEvents,
	userTraits: typed<BrowserUserTraits>(),
	providers: [
		new PostHogClientProvider({
			// Browser-public PostHog project key (phc_...), never a personal API key.
			token: import.meta.env.VITE_POSTHOG_PROJECT_KEY,
		}),
	],
});

const analyticsReady = analytics.initialize();

export async function identifyUser(userId: string, traits: BrowserUserTraits) {
	await analyticsReady;
	analytics.identify(userId, traits);
}
```

Every factory call creates a fresh, registry-bound instance owned by the application. Retain its initialization promise and await readiness before the first `identify()` or identity-sensitive event because some providers ignore identity calls before their SDK is ready. Login, signup, and restored-session/bootstrap flows must await the identity helper; call `analytics.reset()` on logout.

At restored-session bootstrap, identify before enabling identity-sensitive events:

```ts
const restoredSession = await restoreSession();

if (restoredSession.user) {
	await identifyUser(restoredSession.user.id, {
		email: restoredSession.user.email,
		plan: restoredSession.user.plan,
	});
}

// Enable identity-sensitive events only after this bootstrap completes.
```

`track()` returns `Promise<void>`. Await work whose completion matters; use `void analytics.track(...)` for explicitly non-critical browser analytics rather than blocking navigation.

## Server module and critical event

```ts
import { typed } from "trakoo";
import { createServerAnalytics } from "trakoo/server";
import { PostHogServerProvider } from "trakoo/providers/server";
import { appEvents } from "./events";

interface ServerUserTraits {
	plan: "free" | "pro";
}

function createRequestAnalytics() {
	return createServerAnalytics({
		events: appEvents,
		userTraits: typed<ServerUserTraits>(),
		providers: [
			new PostHogServerProvider({
				// PostHog project capture key (phc_...), not a personal API key.
				apiKey: process.env.POSTHOG_PROJECT_KEY!,
			}),
		],
	});
}

export async function trackPurchase(input: {
	orderId: string;
	amount: number;
	currency: string;
	userId: string;
	email: string;
	plan: "free" | "pro";
}) {
	const analytics = createRequestAnalytics();
	try {
		await analytics.track(
			"purchase_completed",
			{
				orderId: input.orderId,
				amount: input.amount,
				currency: input.currency,
			},
			{
				userId: input.userId,
				user: {
					email: input.email,
					traits: { plan: input.plan },
				},
			},
		);
	} finally {
		await analytics.shutdown();
	}
}
```

Server analytics is stateless across users: pass user context with each event and await critical events. For a fresh request-scoped provider/analytics pair, shut down that same pair in `finally`. A reusable instance shuts down only at application or process teardown. Some providers flush buffered events during shutdown; others only clear state. Inspect the selected provider's installed implementation before choosing the lifecycle. Use the platform's `waitUntil` only for explicitly non-critical work.

## Imports and ownership

| Concern | Correct pattern |
|---|---|
| Event helpers and shared types | `trakoo` (environment-neutral) |
| Browser factory | `trakoo/client` |
| Server factory | `trakoo/server` |
| Browser providers | `trakoo/providers/client` |
| Server providers | `trakoo/providers/server` |
| Browser identity | Await initialization before first identity transition; reset on logout |
| Server identity | Pass request user context on every call |
| Critical server delivery | Await `track()`; shutdown follows provider behavior and instance ownership |

Never import a server provider, secret, or unprefixed server environment variable into browser code. Do not use a nonexistent `trakoo/providers` aggregate.

## Verification

Run the consuming project's type checker and narrowest relevant tests. Run its production build when client/server bundling or environment variables changed. Recheck installed declarations when an import, option, event property, or provider constructor fails.

**Maintainer release gate:** This skill must not be published until PR #32's migrated implementation lands and representative consumer fixtures are compiled and typechecked against the real built package, not fabricated declarations. Fixtures must cover root helpers and registry; direct Zod transformation and distinct input/output types; Valibot or ArkType; client and server factories sharing `events`; browser identify traits and nested server traits; a propertyless client call; a propertyless server-options call; and validation `"drop"` and `"throw"`.

## Common mistakes

- Defining calls before the shared runtime registry.
- Forgetting `events: appEvents` in either factory.
- Repeating event generics instead of allowing registry inference.
- Using `typed<T>()` when untrusted runtime input needs a validator.
- Sharing stateful browser identity logic with stateless server analytics.
- Sending all methods and events to providers with different requirements instead of routing them.
- Installing every optional SDK instead of only the selected provider and validator packages.
- Calling `identify()` before client provider initialization or forgetting logout reset.
- Pairing a reusable server instance with per-event shutdown.
