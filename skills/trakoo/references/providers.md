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
