# @trakoo/posthog

PostHog providers for [trakoo](https://www.npmjs.com/package/trakoo), the typed, provider-agnostic analytics library.

## Installation

Install the package with only the PostHog SDK for the side you use:

```bash
# Browser
pnpm add trakoo @trakoo/posthog posthog-js

# Server
pnpm add trakoo @trakoo/posthog posthog-node
```

## Usage

`appEvents` is your event registry, created with `defineEvents()` from `trakoo`.

```typescript title="lib/analytics.ts"
import { createClientAnalytics } from 'trakoo/client';
import { PostHogClientProvider } from '@trakoo/posthog/client';
import { appEvents } from './events';

export const analytics = createClientAnalytics({
  events: appEvents,
  providers: [
    new PostHogClientProvider({
      token: import.meta.env.VITE_POSTHOG_KEY,
      api_host: import.meta.env.VITE_POSTHOG_HOST
    })
  ]
});
```

```typescript title="lib/server-analytics.ts"
import { createServerAnalytics } from 'trakoo/server';
import { PostHogServerProvider } from '@trakoo/posthog/server';
import { appEvents } from './events';

export function createRequestAnalytics() {
  return createServerAnalytics({
    events: appEvents,
    providers: [
      new PostHogServerProvider({
        apiKey: process.env.POSTHOG_API_KEY!,
        host: 'https://us.i.posthog.com'
      })
    ]
  });
}
```

PostHog's Node client queues events. Call `shutdown()` on a request-owned instance before the request ends.

Server events take their distinct ID from each call. An event without a user is sent anonymously, without a person profile. Pass the visitor's IP and user agent as `context.server` so PostHog can locate the visitor and see their browser. The provider sends them as `$ip` and `$raw_user_agent`, and turns GeoIP on for events that carry an IP unless you set `disableGeoip`.

In the browser, PostHog captures page views on its own by default. If you call trakoo's `pageView()`, set `capture_pageview: false` so views aren't counted twice.

## Documentation

https://trakoo.co/docs/providers/posthog
