---
name: trakoo
description: Use when adding, configuring, or troubleshooting Trakoo analytics in TypeScript applications, including typed events, browser or server tracking, PostHog, OpenPanel, Bento, Pirsch, EmitKit, Visitors, Proxy, provider routing, user identification, or framework integration.
---

# Trakoo Integration

Trakoo is a typed, provider-agnostic analytics library. Preserve its central event contract and its browser/server boundary; those two choices prevent most integration errors.

## Start by inspecting the application

Before editing, detect the package manager, framework, installed `trakoo` version, browser/server entry points, existing analytics dependencies, and available verification commands. Determine whether each requested event is a browser interaction, an authoritative server event, or both.

Use the consuming project's installed Trakoo declarations as the source of truth. Consult the official Trakoo docs at https://stacksee-analytics.vercel.app, but if they differ from the installed declarations, explain the version mismatch; do not silently upgrade or invent an API.

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

const analyticsReady = analytics.initialize();

export async function identifyUser(
	userId: string,
	traits: { email?: string },
) {
	await analyticsReady;
	analytics.identify(userId, traits);
}
```

Create one browser instance per session and retain its initialization promise. Await readiness before the first `identify()` or identity-sensitive event because some providers ignore identity calls made before their SDK is ready. Login, signup, and restored-session/bootstrap flows must await the identity helper; call `analytics.reset()` on logout.

At the application's restored-session bootstrap boundary, await identity before enabling or emitting identity-sensitive events:

```ts
const restoredSession = await restoreSession();

if (restoredSession.user) {
	await identifyUser(restoredSession.user.id, {
		email: restoredSession.user.email,
	});
}

// Enable identity-sensitive events only after this bootstrap completes.
```

Browser tracking is normally fire-and-forget after readiness; do not block navigation on non-critical analytics.

## Server module and critical event

```ts
import { createServerAnalytics } from "trakoo/server";
import { PostHogServerProvider } from "trakoo/providers/server";
import type { AppEvents } from "./events";

function createRequestAnalytics() {
	return createServerAnalytics<AppEvents>({
		providers: [
			new PostHogServerProvider({ apiKey: process.env.POSTHOG_API_KEY! }),
		],
	});
}

export async function trackPurchase(input: {
	orderId: string;
	amount: number;
	currency: string;
	userId: string;
	email: string;
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
			{ userId: input.userId, user: { email: input.email } },
		);
	} finally {
		await analytics.shutdown();
	}
}
```

Server analytics is stateless across users: pass user context with each event and await critical events. Make server shutdown provider- and ownership-aware. For a fresh request-scoped provider/analytics pair, shut down that same pair in `finally`. For a reusable module instance, shut it down only at application or process teardown. Some providers flush buffered events during shutdown; others only clear state. Read the selected provider's installed implementation before choosing the lifecycle. Use the platform's `waitUntil` only for explicitly non-critical work.

Ownership summary: reusable instances shut down at teardown; request-scoped instances shut down in `finally`.

## Import and lifecycle reference

| Concern | Correct pattern |
|---|---|
| Shared types | `trakoo` |
| Browser factory | `trakoo/client` |
| Server factory | `trakoo/server` |
| Browser providers | `trakoo/providers/client` |
| Server providers | `trakoo/providers/server` |
| Browser identity | Retain/await `initialize()` before first `identify()`; `reset()` on logout |
| Server identity | Context on every call |
| Critical server delivery | Await `track()`; shutdown timing follows provider behavior and instance ownership |

Never import a server provider, secret, or unprefixed server environment variable into browser code. Do not use a nonexistent `trakoo/providers` aggregate.

## Verification

Use the consuming project's commands. At minimum, run its type checker and the narrowest relevant tests; run its production build when client/server bundling or environment variables changed. Recheck installed declarations when an import, option, event property, or provider constructor fails.

## Common mistakes

- Tracking first and defining events later, which loses useful type pressure.
- Omitting `AppEvents` from an analytics factory.
- Sharing stateful browser identity logic with stateless server analytics.
- Sending every method and event to providers with different requirements instead of routing them.
- Installing all optional provider SDKs instead of only those selected.
- Calling `identify()` before client provider initialization, or forgetting logout reset.
- Pairing a reusable server singleton with per-event shutdown.
