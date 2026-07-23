# trakoo

## 1.0.0

### Major Changes

- Replace type-asserted event collections with runtime `defineEvents()` registries based on Standard Schema. Add direct validator interoperability, validator-free `typed<T>()` events, propertyless events, inferred client/server factories, normalized validation failures, and validated provider outputs. Server `track()` calls now fail closed with the new `invalid_options` code when the options argument contains an unrecognized key, and Proxy replay no longer re-runs Standard Schema validators against already-validated client output. This removes the legacy event helper types and client singleton convenience API; see the [Standard Schema migration guide](https://trakoo.co/docs/guides/standard-schema-migration). ([#32](https://github.com/multiplehats/trakoo/pull/32))

## 0.1.0

### Minor Changes

- Add OpenPanel client and server providers with event tracking, user identification, page views, and safe server-side identity isolation. ([#27](https://github.com/multiplehats/trakoo/pull/27))

### Patch Changes

- Preserve page-path metadata on OpenPanel client events tracked before a page view. ([#27](https://github.com/multiplehats/trakoo/pull/27))

## 0.14.5

### Patch Changes

- Add `default` export condition to all subpath exports so CJS resolvers (e.g. tsx, esbuild) can find them ([`f69b4ec`](https://github.com/stackseehq/analytics/commit/f69b4ec79fc4c6211fbb8d8d522bbe68a45905f8))

## 0.14.4

### Patch Changes

- fix(pirsch): rewrite client provider to use CDN script injection ([`7fd6d17`](https://github.com/stackseehq/analytics/commit/7fd6d17f7adcd3f022bf797e7d7064038610a6ba))

  The previous `PirschClientProvider` incorrectly used `pirsch-sdk` (a
  Node.js npm package) to instantiate a `PirschWebClient` class in the
  browser. This caused `TypeError: e is not a constructor` at runtime
  because the CJS class cannot be used in a browser bundle.

  The provider now follows the same pattern as `VisitorsClientProvider`:

  - Dynamically injects `https://api.pirsch.io/pa.js` into `<head>`
  - Waits for the `window.pirsch()` global function to become available
  - Tracks events via `pirsch(eventName, { meta: { ...properties } })`
  - Page views and page leave are handled automatically by pa.js

  `pirsch-sdk` has been removed as a dependency entirely.

## 0.14.3

### Patch Changes

- fix(pirsch): externalize pirsch-sdk from library build ([`3d9938f`](https://github.com/stackseehq/analytics/commit/3d9938f49907f4d54da6a9b8bedaacd9d61dddb2))

  `pirsch-sdk` was not listed in `rollupOptions.external`, causing Vite to bundle it into an internal chunk (`web-D-ZwlgeQ.js`) and load it via a relative dynamic import. When consumers re-bundled the library (e.g. with Vite/Astro), the relative path broke and `PirschClientProvider.initialize()` failed with `Cannot destructure property 'Pirsch' of undefined`.

  `pirsch-sdk` and `pirsch-sdk/web` are now externalized so the consumer's bundler resolves them directly.

## 0.14.2

### Patch Changes

- Fix `VisitorsClientProvider` 429 Too Many Requests errors in production. ([`ef8cc4e`](https://github.com/stackseehq/analytics/commit/ef8cc4e66990f36950267632e11af10e61d61b41))

  **Concurrent init race**: `initialize()` now coalesces concurrent calls onto a single in-flight Promise instead of checking a boolean flag that is only set after async work completes. Previously, two callers entering simultaneously each injected the script and triggered duplicate automatic page-view POSTs to `e.visitors.now/e`.

  **Identify deduplication**: `identify()` now skips the SDK call when the same user ID has already been sent in the current session. Calling `analytics.identify(user)` on every route change (a common Next.js layout pattern) no longer fires a network request on each navigation.

## 0.14.1

### Patch Changes

- Add `persist` option to `VisitorsClientProvider`. When `persist: true`, the `data-persist` attribute is set on the injected script tag, enabling the visitor cookie required for cross-session tracking and Stripe revenue attribution via `getVisitorId()`. ([`c4f43ca`](https://github.com/stackseehq/analytics/commit/c4f43caf722e23d2ecf302c59a48f6dfe152bd67))

## 0.14.0

### Minor Changes

- Add `VisitorsClientProvider` for [visitors.now](https://visitors.now) analytics. ([`d3bb7e6`](https://github.com/stackseehq/analytics/commit/d3bb7e615783b982f82c5277c53be2b87a72a1fb))

  - Dynamically loads `cdn.visitors.now/v.js` with your project token — no npm dependency required
  - Supports `track()`, `identify()`, `pageLeave()` (page views are handled automatically by the script)
  - `getVisitorId()` helper reads the `visitor` cookie for Stripe revenue attribution
  - Full E2E test suite (Playwright) and unit tests (vitest/jsdom) included

## 0.13.2

### Patch Changes

- Fix fire-and-forget pageView/identify causing AbortError on Vercel ([`3910b5a`](https://github.com/stackseehq/analytics/commit/3910b5ac8aa4b0c5fdbe76fb23b6153b742fe95f))

  On Vercel (and other serverless platforms), when an API route returns its HTTP
  response, the Node.js process is frozen immediately. Any pending async work that
  wasn't awaited gets aborted with `DOMException [AbortError]: This operation was aborted`.

  The root cause was that `pageView` and `identify` were fire-and-forget at every
  layer of the stack:

  - `PirschServerProvider.pageView/identify` — called `this.request().catch()` without awaiting
  - `EmitKitServerProvider.pageView/identify` — called SDK methods with `.then().catch()` without awaiting
  - `BentoServerProvider.pageView/identify` — called SDK methods with `.catch()` without awaiting
  - `ServerAnalytics.pageView/identify` — did not await provider calls
  - `ingestProxyEvents` — did not await `analytics.pageView/identify`

  This meant that when the proxy handler returned `200 OK`, Vercel froze the process
  before the OAuth token fetch or API hit could complete, causing the abort.

  Fix: all `pageView` and `identify` methods now return `Promise<void>` and are
  properly awaited through the full call chain.

## 0.13.1

### Patch Changes

- Fix Pirsch server provider for full API compliance ([`95628d8`](https://github.com/stackseehq/analytics/commit/95628d80448fb698854946506054c7bbb21785fc))

  - Fix `event_meta` to use string values only (API requirement)
  - Remove invalid fallback URLs in `buildHit()`
  - Add `disableBotFilter` config option
  - Add `non_interactive` event support
  - Mark synthetic events (`identify`, `reset`) as non-interactive

## 0.13.0

### Minor Changes

- Add flexible channel routing to EmitKit provider ([`f999368`](https://github.com/stackseehq/analytics/commit/f999368550187429f9470164dadbd89850258823))

  Adds powerful channel routing capabilities to the EmitKit provider, allowing users to organize events across different EmitKit channels (similar to Slack channels) automatically.

  **New Features:**

  - **Default channel configuration**: Set a global default channel for all events (now defaults to `'general'` instead of `'analytics'`)
  - **Category-based channel mapping**: Automatically route events to specific channels based on their category using the new `categoryChannelMap` option
  - **Per-event channel override**: Override the channel for specific events using the `__emitkit_channel` property
  - **Priority-based resolution**: Clear 3-tier priority system ensures predictable channel routing

  **Channel Resolution Priority:**

  1. Event property `__emitkit_channel` (highest priority - per-event override)
  2. Category mapping via `categoryChannelMap` (category-based routing)
  3. Default `channelName` (fallback, defaults to `'general'`)

  **Example Usage:**

  ```typescript
  // Basic: Set a default channel
  const analytics = createServerAnalytics({
    providers: [
      new EmitKitServerProvider({
        apiKey: "emitkit_...",
        channelName: "app-events", // All events go here
      }),
    ],
  });

  // Advanced: Category-based routing
  const analytics = createServerAnalytics({
    providers: [
      new EmitKitServerProvider({
        apiKey: "emitkit_...",
        channelName: "general", // Fallback channel
        categoryChannelMap: {
          user: "user-activity", // All user events → user-activity
          engagement: "product-usage", // All engagement → product-usage
          error: "alerts", // All errors → alerts
          conversion: "revenue", // All conversions → revenue
        },
      }),
    ],
  });

  // Per-event override
  analytics.track("payment_processed", {
    amount: 100,
    currency: "USD",
    __emitkit_channel: "critical-payments", // Override to critical channel
  });
  ```

  **Benefits:**

  - Organize events like Slack channels for better team visibility
  - Automatic routing based on event categories (user, engagement, error, etc.)
  - Flexible per-event overrides for critical events
  - Works with both `track()` and `pageView()` methods

  **Breaking Changes:** None - fully backward compatible. The default channel changes from `'analytics'` to `'general'`, but this is a soft change that only affects new installations.

## 0.12.0

### Minor Changes

- Add event-level provider routing system ([`fa7278f`](https://github.com/stackseehq/analytics/commit/fa7278f96e46eb6dd7ba361f4fa6293acefc57b4))

  Extends the existing provider routing system with event-level filtering, solving the "1-to-50 problem" where you need to route specific events to specific providers without excluding 49 other events.

  **New Features:**

  - **Event whitelisting**: Use the `events` option to specify which events should be tracked on a provider
  - **Event blacklisting**: Use the `excludeEvents` option to exclude specific events from a provider
  - **Event pattern matching**: Use the `eventPatterns` option with glob-style patterns (e.g., `newsletter_*`) for flexible event routing
  - **Combined routing**: Mix method routing (`methods`, `exclude`) with event routing for fine-grained control
  - **Full TypeScript support**: Method routing has full autocomplete and type safety
  - **Client & Server**: Works on both client-side and server-side analytics

  **Example Usage:**

  ```typescript
  const analytics = createServerAnalytics({
    providers: [
      // All events go to PostHog
      new PostHogServerProvider({ token: "xxx" }),

      // Only newsletter_signup goes to EmitKit
      {
        provider: new EmitKitServerProvider({ apiKey: "xxx" }),
        events: ["newsletter_signup"], // Just 1 event instead of excluding 49!
        methods: ["track"], // Optional: also skip identify/pageView
      },

      // Only newsletter events (using patterns)
      {
        provider: new CustomEmailProvider({ apiKey: "xxx" }),
        eventPatterns: ["newsletter_*"], // Matches newsletter_signup, newsletter_unsubscribe, etc.
      },

      // Everything except page views
      {
        provider: new BentoServerProvider({ siteUuid: "xxx" }),
        excludeEvents: ["page_view"],
      },
    ],
  });
  ```

  **Breaking Changes:** None - fully backward compatible with existing code.

  **Note:** Event names (`events`, `excludeEvents`, `eventPatterns`) currently accept any string. Future enhancement could add type safety based on the event map passed to `createServerAnalytics<TEventMap>()` or `createClientAnalytics<TEventMap>()`.

## 0.11.1

### Patch Changes

- Fix proxy provider queue flushing and add manual flush support ([`3b0c775`](https://github.com/stackseehq/analytics/commit/3b0c7750f04f28d695f3f413e69391994f58a048))

  **Bug Fixes:**

  - **Fixed event loss in proxy provider**: Events were being lost when users triggered only 1-2 events because the flush timer wasn't resetting properly. The timer now resets with each new event, ensuring events are flushed after the configured interval from the last event.
  - **Reduced default batch interval**: Changed default `batchInterval` from 5000ms to 2000ms for better responsiveness and fewer lost events.

  **New Features:**

  - **Added `flush()` method**: New method on `BrowserAnalytics` and convenience export from client to manually flush all queued events to providers. This is particularly useful for ensuring critical events are sent before navigation or page unload.

  **Example Usage:**

  ```typescript
  // Ensure critical events are sent before navigation
  await analytics.track("purchase_completed", { orderId: "123" });
  await analytics.flush(); // Wait for confirmation
  window.location.href = "/thank-you";

  // Or use with beacon API for page unload
  await analytics.flush(true); // Uses beacon API for reliability
  ```

  **Technical Details:**

  - Added optional `flush(useBeacon?: boolean)` method to `AnalyticsProvider` interface
  - Proxy provider's `beforeunload` and `visibilitychange` listeners automatically call `flush(true)` with beacon API for reliable delivery during page transitions
  - All providers that implement batching can now be manually flushed

## 0.11.0

### Minor Changes

- feat: add EmitKit server provider ([`b4d5561`](https://github.com/stackseehq/analytics/commit/b4d55618e362f8fd4b7f6e6e0275298c19bd7738))

  Adds support for EmitKit as a server-side analytics provider. EmitKit is a notification and event tracking service that allows you to send events to channels with rich metadata.

  **New Provider:**

  - `EmitKitServerProvider` - Server-side provider for EmitKit API

  **Features:**

  - User identification with alias support (email, username, custom identifiers)
  - Event tracking with configurable channels and rich metadata
  - Page view tracking
  - Auto-formatted event titles and category-based icons
  - Support for tags, notifications, and display modes
  - Rate limit handling

  **Configuration:**

  ```typescript
  import { EmitKitServerProvider } from "@stacksee/analytics/providers/server";

  const analytics = new ServerAnalytics({
    providers: [
      new EmitKitServerProvider({
        apiKey: "emitkit_xxxxx",
        channelName: "analytics",
        notify: true,
        displayAs: "notification",
      }),
    ],
  });
  ```

  **Note:** EmitKit is server-only. For client-side events, use the proxy pattern to forward events from the browser to your server endpoint.

## 0.10.0

### Minor Changes

- Add provider routing system for selective method control ([`e9af485`](https://github.com/stackseehq/analytics/commit/e9af485523a433f946035661939370d389435bca))

  Introduces a new provider routing system that allows fine-grained control over which methods are called on specific providers. This enables scenarios like using Bento only for user identification and custom events while excluding page views to reduce noise.

  **New Features:**

  - **Selective method inclusion**: Use the `methods` option to specify which methods should be called on a provider
  - **Method exclusion**: Use the `exclude` option to prevent specific methods from being called
  - **Mixed provider configurations**: Combine simple providers with routed providers in the same setup
  - **Full TypeScript support**: Type-safe method names with autocomplete

  **Example Usage:**

  ```typescript
  const analytics = createClientAnalytics({
    providers: [
      // Simple form - gets all methods
      new PostHogClientProvider({ token: "xxx" }),

      // Exclude page views from Bento
      {
        provider: new BentoClientProvider({ siteUuid: "xxx" }),
        exclude: ["pageView"],
      },

      // CRM only needs identity data
      {
        provider: new CustomCRMProvider({ apiKey: "xxx" }),
        methods: ["identify"],
      },
    ],
  });
  ```

  **Breaking Changes:** None - fully backward compatible with existing code.

## 0.9.8

### Patch Changes

- refactor(proxy): improve type safety and context enrichment

  - **Type Definitions**: Added `ServerContext` interface with fields for `userAgent`, `ip`, `requestId`, and `timestamp`
  - **EventContext Extensions**: Extended `EventContext` with `server?: ServerContext` and added `ip?: string` to device context
  - **Proxy Server**: Reduced `any` type usage by 87.5% in proxy server implementation
  - **User-Agent Enrichment**: Automatically extract and add user-agent from request headers to server context
  - **IP Enrichment**: IP addresses now properly typed in device context (no type assertions needed)
  - **Context Merging**: Fixed type-safe merging of custom enrichContext with automatic server enrichment
  - **Tests**: Updated all proxy server tests to use proper types (removed all `as any` assertions)
  - **Backwards Compatible**: All changes maintain 100% API compatibility

  This improves type safety at the HTTP/JSON boundary while maintaining flexibility for server-side context enrichment.

## 0.9.7

### Patch Changes

- fix(pirsch): resolve network errors from invalid context data

  - Add validation for OAuth authentication requiring both clientId and clientSecret
  - Skip tracking events when IP or User-Agent is missing from context instead of using dummy values
  - Pirsch API rejects invalid/dummy data (like "0.0.0.0" or "unknown"), causing Network Errors
  - Add clear logging when events are skipped due to missing context
  - Update documentation with authentication options and context requirements

## 0.9.6

### Patch Changes

- fix(pirsch): add screen dimensions, viewport, language, and platform tracking

  - Added screen_width and screen_height mapping from client context
  - Added sec_ch_viewport_width for viewport width tracking
  - Added accept_language for language/locale tracking
  - Added sec_ch_ua_mobile and sec_ch_ua_platform for device type and OS tracking
  - Added timezone and browser to event metadata
  - Updated EventContext type to include screen, viewport, userAgent, language, and timezone fields

  This resolves the issue where screen data was showing as null in Pirsch analytics.

## 0.9.5

### Patch Changes

- Fix Pirsch provider tracking issues

  - **PirschServerProvider**: Extract real IP addresses and user-agents from proxy handler context instead of using hardcoded dummy values ("0.0.0.0" and "analytics-library"). Pirsch was rejecting hits with invalid IPs.
  - **PirschServerProvider**: Build full URLs (e.g., "https://example.com/pricing") instead of sending just paths ("/pricing"), as required by Pirsch SDK.
  - **PirschClientProvider**: Optimize page view tracking by passing properties as tags directly to `hit()` call instead of sending a separate event.

## 0.9.4

### Patch Changes

- Release version 0.9.1 ([`d7b9f69`](https://github.com/stackseehq/analytics/commit/d7b9f69c4e23414ca6371c661a8df417af719fe2))

## 0.4.2

### Patch Changes

- Fix build configuration to properly handle Node.js modules by externalizing posthog dependencies ([`3fbd302`](https://github.com/stackseehq/analytics/commit/3fbd30279e8b0fbde9ec26c3c25b98b6decb551e))

## 0.2.0

### Minor Changes

- Initial version ([`9ff5477`](https://github.com/stackseehq/analytics/commit/9ff54778beb3a4b2e32e61619c6e4e7c467fb9cf))
