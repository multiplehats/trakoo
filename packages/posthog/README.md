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

## Documentation

https://trakoo.co/docs/providers/posthog
