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

The current server constructor is `BentoServerProvider({ siteUuid, authentication: { publishableKey, secretKey } })`. All three values are server-only:

```ts
import { createServerAnalytics } from "trakoo/server";
import { BentoServerProvider } from "trakoo/providers/server";
import type { AppEvents } from "./events";

export async function createBentoAnalytics() {
	const provider = new BentoServerProvider({
		siteUuid: process.env.BENTO_SITE_UUID!,
		authentication: {
			publishableKey: process.env.BENTO_PUBLISHABLE_KEY!,
			secretKey: process.env.BENTO_SECRET_KEY!,
		},
	});

	await provider.initialize();

	return createServerAnalytics<AppEvents>({ providers: [provider] });
}
```

Keep `BENTO_SITE_UUID`, `BENTO_PUBLISHABLE_KEY`, and `BENTO_SECRET_KEY` server-only; never expose them through client-prefixed environment variables.

Explicitly await `BentoServerProvider.initialize()` before the first event. For request-scoped ownership, create a fresh provider and analytics pair, use it for that request, and shut down that same pair in `finally`:

```ts
const analytics = await createBentoAnalytics();

try {
	await analytics.track("signup_completed", properties, {
		userId,
		user: { email },
	});
} finally {
	await analytics.shutdown();
}
```

For a long-lived module instance, call `shutdown()` only at application or process teardown. Do not call `shutdown()` after each event on a reusable module singleton. Bento `shutdown()` clears provider state; it is not a buffered flush.

### Pirsch

No extra package is required. The current client constructor is `PirschClientProvider({ identificationCode, hostname? })`:

```ts
import { PirschClientProvider } from "trakoo/providers/client";

const provider = new PirschClientProvider({
	identificationCode: import.meta.env.VITE_PIRSCH_IDENTIFICATION_CODE,
});
```

`VITE_PIRSCH_IDENTIFICATION_CODE` and an optional hostname override are browser-public configuration, not secrets. Pirsch's `pa.js` script handles the initial page load; the current provider's `pageView()` is a no-op. Consequently, `methods: ["pageView"]` does not emit SPA navigation hits. Check the installed Pirsch provider and version for a supported SPA delivery path. If it has no programmatic navigation delivery, integrate a supported Pirsch SPA path directly or route completed client navigations to another provider; do not imply that routing alone emits them.

A server event without the original IP address and User-Agent cannot be attributed and is skipped. Proxy browser events through a server endpoint when that request context is needed.

### Visitors

Visitors is browser-only. `pageView()` does not send a duplicate because its script tracks page loads automatically. Non-scalar custom properties are dropped. `identify()` requires persistence and, where applicable, explicit consent.

### Proxy

Import `ProxyProvider` from `trakoo/providers/client`; import `createProxyHandler` or `ingestProxyEvents` from `trakoo/providers/server`. Keep the endpoint same-origin when the goal is first-party delivery. Configure batch size and interval only when defaults do not meet the application's delivery needs.

## Custom providers

Extend `BaseAnalyticsProvider` from the environment-specific provider export and implement the `AnalyticsProvider` contract. Preserve Trakoo's event `action`, properties, and context; do not put vendor-specific behavior into shared event definitions.

## Verification

Typecheck constructor options against the installed provider types. Exercise one representative event per routing branch and confirm excluded events or methods do not reach that provider. Verify an initial page load and one completed SPA navigation independently. For server providers, exercise two sequential lifecycle events and confirm initialization and shutdown match instance ownership. For buffered server SDKs, verify the handler flushes before exit.
