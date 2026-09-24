# Provider Reference

Read the selected provider's installed constructor types and official Trakoo provider page before generating final code. Install only dependencies required by the selected side.

Core `trakoo` declares no provider SDK. Providers that need no SDK ship in `trakoo/providers/client` and `trakoo/providers/server`. SDK-backed providers ship as separate adapter packages with `/client` and `/server` subpaths; install the adapter next to only the SDK for the side that uses it, for example `pnpm add @trakoo/posthog posthog-node` for server-only PostHog.

Import the shared runtime registry into every analytics module and pass `events: appEvents` to each client or server factory. Provider routing selects delivery targets; it does not replace registry validation.

## Capability and dependency matrix

| Provider | Browser | Server | Import from | Install beside `trakoo` | Use and constraints |
|---|---:|---:|---|---|---|
| PostHog | Yes | Yes | `@trakoo/posthog/client`, `@trakoo/posthog/server` | `@trakoo/posthog` plus browser `posthog-js` and/or server `posthog-node` | General product analytics. Keep the server key out of browser code. |
| OpenPanel | Yes | Yes | `@trakoo/openpanel/client`, `@trakoo/openpanel/server` | `@trakoo/openpanel` plus browser `@openpanel/web` and/or server `@openpanel/sdk` | Product and web analytics across both runtimes. |
| Bento | Yes | Yes | Browser: `trakoo/providers/client`; server: `@trakoo/bento/server` | Browser: none; server: `@trakoo/bento` and `@bentonow/bento-node-sdk` | Browser page views may be anonymous. Email is required for identification, identified lifecycle events, and server events. |
| Pirsch | Yes | Yes | `trakoo/providers/client`, `trakoo/providers/server` | None | Privacy-first analytics. Server hits require the visitor IP address and User-Agent request context. |
| EmitKit | No | Yes | `@trakoo/emitkit/server` | `@trakoo/emitkit` and `@emitkit/js` | Server-side event notifications; verify its current constructor from installed types. |
| Visitors | Yes | No | `trakoo/providers/client` | None | Privacy-friendly web analytics. `identify()` does not itself require persistence; persistence enables cross-session tracking and revenue attribution. Page views are automatic. |
| Proxy | Yes | Ingestion helpers | `trakoo/providers/client`, `trakoo/providers/server` | None | First-party batching from `ProxyProvider` to `createProxyHandler` or `ingestProxyEvents`. It is transport, not an analytics vendor. |

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

### PostHog

Both PostHog constructors take a project capture credential (project API key), normally shaped like `phc_project_key`. A `phx_` value is a personal API key; never use or recommend a personal API key for event capture.

Map the browser-public project key to client `token` and the deployment's server value to server `apiKey`:

```ts
import { PostHogClientProvider } from "@trakoo/posthog/client";
import { PostHogServerProvider } from "@trakoo/posthog/server";

const clientProvider = new PostHogClientProvider({
	token: import.meta.env.VITE_POSTHOG_PROJECT_KEY,
	capture_pageview: false,
	capture_pageleave: false,
});

const serverProvider = new PostHogServerProvider({
	apiKey: process.env.POSTHOG_PROJECT_KEY!,
});
```

`VITE_POSTHOG_PROJECT_KEY` is intentionally browser-public. `POSTHOG_PROJECT_KEY` stays in server configuration even though both values identify the project. Do not expose unrelated server settings or personal credentials through the public prefix.

Choose one page-view owner. When the application router owns initial and navigation views, set `capture_pageview: false` before manually emitting either stream. When PostHog auto-capture owns page views, do not add a manual initial view or router subscription. For page-leave tracking, use the same one-owner rule: set `capture_pageleave: false` when the application emits page leaves itself, or leave manual tracking out when PostHog owns it.

For a router-owned stream, normalize every initial and navigation URL with the same function before deduplicating. Resolve relative router hrefs against `window.location.origin`, then compare the resulting absolute URL:

```ts
function normalizePageUrl(href: string): string {
	const url = new URL(href, window.location.origin);
	url.hash = "";
	return url.href;
}
```

### Bento

Bento's browser integration can record anonymous page views. A valid email is required for `identify()`, identified lifecycle events, and server events; it is not required for every browser page view. Route other anonymous traffic according to the installed provider's supported methods.

The current server constructor is `BentoServerProvider({ siteUuid, authentication: { publishableKey, secretKey } })`. All three values are server-only:

```ts
import { createServerAnalytics } from "trakoo/server";
import { BentoServerProvider } from "@trakoo/bento/server";
import { appEvents } from "./events";

export async function createBentoAnalytics() {
	const provider = new BentoServerProvider({
		siteUuid: process.env.BENTO_SITE_UUID!,
		authentication: {
			publishableKey: process.env.BENTO_PUBLISHABLE_KEY!,
			secretKey: process.env.BENTO_SECRET_KEY!,
		},
	});

	await provider.initialize();

	return createServerAnalytics({
		events: appEvents,
		providers: [provider],
	});
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

### EmitKit

EmitKit is server-only. Construct `EmitKitServerProvider` with the server-only `EMITKIT_API_KEY`, explicitly await its initialization, and only then pass it to `createServerAnalytics()`:

```ts
import { createServerAnalytics } from "trakoo/server";
import { EmitKitServerProvider } from "@trakoo/emitkit/server";
import { appEvents } from "./events";

export async function createEmitKitAnalytics() {
	const provider = new EmitKitServerProvider({
		apiKey: process.env.EMITKIT_API_KEY!,
	});

	await provider.initialize();

	return createServerAnalytics({
		events: appEvents,
		providers: [provider],
	});
}
```

`EMITKIT_API_KEY` is server-only. Never expose it through client-prefixed environment variables or import this module into browser code. EmitKit dynamically imports its SDK; early calls can be skipped until initialization completes, so awaiting `provider.initialize()` before the factory is required.

For request-scoped ownership, create a fresh provider and analytics pair and shut down that same pair in `finally`. For a reusable instance, call `shutdown()` only at application or process teardown. EmitKit sends immediately rather than buffering; its shutdown clears the provider's client state.

### OpenPanel

`OpenPanelClientProvider({ clientId })` in the browser and `OpenPanelServerProvider({ clientId, clientSecret })` on the server. The client ID is browser-public; the client secret is server-only.

```ts
import { OpenPanelServerProvider } from "@trakoo/openpanel/server";

new OpenPanelServerProvider({
	clientId: process.env.OPENPANEL_CLIENT_ID!,
	clientSecret: process.env.OPENPANEL_CLIENT_SECRET!,
	onDeliveryFailure: (failure) =>
		logger.warn("openpanel_delivery_failed", failure.reason, failure.status),
});
```

A server event carries the server's own IP and user agent, so OpenPanel attributes it to the datacenter unless the caller's request context is passed. Put the caller's address and user agent on `context.server` and the provider forwards them as the `openpanel-client-ip` and `user-agent` headers OpenPanel resolves geo and device from:

```ts
await analytics.track("api_request", { route: "/v1/generations" }, {
	userId,
	context: {
		server: {
			ip: clientIpFrom(request),
			userAgent: request.headers.get("user-agent") ?? undefined,
		},
	},
});
```

Attribution is per event, so one long-lived provider serves concurrent requests correctly. `context.device` is the fallback when `context.server` is absent. The IP is sent as a header only and never stored as an event property. Resolve the address from a header the deployment's trusted proxies actually set; forwarding an unvalidated one attributes events to whatever the caller claims.

OpenPanel's SDKs drop events rejected with HTTP 401 without throwing, retrying or logging, so a wrong key, a rotated secret or a browser origin the project does not allow stops analytics silently. `onDeliveryFailure` reports those rejections; without a handler trakoo logs them. It carries the envelope type, status and ingestion URL, never event properties. Delivery never throws, so a rejected event never becomes an application error.

Browser events are rejected with the same 401 when the page origin is not on the project's allowed origins, so a client ID that works in production can be refused from `localhost`.

### Pirsch

No extra package is required. The current client constructor is `PirschClientProvider({ identificationCode, hostname? })`:

```ts
import { PirschClientProvider } from "trakoo/providers/client";

const provider = new PirschClientProvider({
	identificationCode: import.meta.env.VITE_PIRSCH_IDENTIFICATION_CODE,
});
```

`VITE_PIRSCH_IDENTIFICATION_CODE` and an optional hostname override are browser-public configuration, not secrets. Pirsch's `pa.js` script records the initial page load and programmatic History API URL changes by default. The current provider's `pageView()` is therefore a no-op, and `methods: ["pageView"]` does not emit SPA navigation hits. Do not add a duplicate router hook when `pa.js` can observe the navigation. Verify one initial hit and one SPA navigation hit in the browser Network panel.

`window.pirsch(name, options)` is the custom-event API, not a programmatic page-view API. Do not redeclare `Window.pirsch` in consuming code; importing `PirschClientProvider` already supplies its installed type. If a router does not produce observable History API changes, use a page-view API explicitly supported by the installed Pirsch version or route navigation page views elsewhere.

Even when the selected configuration is browser-only, state the server delivery constraint: Pirsch server hits require the visitor's original IP address and User-Agent; without both, they cannot be attributed and are skipped. Proxy browser events through a server endpoint when that request context is needed.

### Visitors

Visitors is browser-only. `pageView()` does not send a duplicate because its script tracks page loads automatically. Non-scalar custom properties are dropped. `identify()` itself does not require persistence. Enable persistence when the application needs cross-session tracking or revenue attribution, and apply the appropriate consent rules whenever identification or persistence is used.

### Proxy

Import `ProxyProvider` from `trakoo/providers/client`; import `createProxyHandler` or `ingestProxyEvents` from `trakoo/providers/server`. Treat its endpoint as an application endpoint accepting untrusted JSON, not as a trusted internal channel. Require a same-origin `Origin` check for first-party browser delivery. If cross-origin delivery is intentional, enforce an explicit CORS allowlist; when ingestion is user-scoped, require and verify an authenticated session as well.

Enforce a request body byte limit and decoded batch-size limits before ingestion, and rate limit the endpoint by an application-appropriate identity. Configure the deployment's trusted proxies before trusting `Forwarded`, `X-Forwarded-For`, or similar forwarded IP headers; otherwise use the directly observed peer address and do not treat forwarded values as visitor context.

Pass the same `appEvents` registry to the browser analytics factory and the ingesting server analytics factory. The server registry must still reject or drop unknown names and validate schema-backed properties before provider routing. That runtime registry validation is necessary but not sufficient: it proves event shape, not caller authorization or truth. Never trust client-proxied `userId`, traits, or events as authoritative. Derive identity and critical business events from the authenticated session and server-owned state, and emit authoritative events at the server operation that confirms them.

## Custom providers

Extend `BaseAnalyticsProvider` from the environment-specific export (`trakoo/client` or `trakoo/server`), or from the root `trakoo` entry for a provider package shared by both runtimes, and implement the `AnalyticsProvider` contract. Preserve Trakoo's event `action`, properties, and context; do not put vendor-specific behavior into shared event definitions.

## Verification

Typecheck constructor options against the installed provider types. Exercise one representative event per routing branch and confirm excluded events or methods do not reach that provider. Verify an initial page load and one completed SPA navigation independently. For server providers, exercise two sequential lifecycle events and confirm initialization and shutdown match instance ownership. For buffered server SDKs, verify the handler flushes before exit.
