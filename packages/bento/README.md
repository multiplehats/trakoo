# @trakoo/bento

Bento server provider for [trakoo](https://www.npmjs.com/package/trakoo), the typed, provider-agnostic analytics library.

The browser provider, `BentoClientProvider`, needs no SDK and ships with trakoo in `trakoo/providers/client`. Install this package only for server-side tracking.

## Installation

```bash
pnpm add trakoo @trakoo/bento @bentonow/bento-node-sdk
```

## Usage

`appEvents` is your event registry, created with `defineEvents()` from `trakoo`.

```typescript title="lib/server-analytics.ts"
import { createServerAnalytics } from 'trakoo/server';
import { BentoServerProvider } from '@trakoo/bento/server';
import { appEvents } from './events';

export const serverAnalytics = createServerAnalytics({
  events: appEvents,
  providers: [
    {
      provider: new BentoServerProvider({
        siteUuid: process.env.BENTO_SITE_UUID!,
        authentication: {
          publishableKey: process.env.BENTO_PUBLISHABLE_KEY!,
          secretKey: process.env.BENTO_SECRET_KEY!
        }
      }),
      exclude: ['pageView']
    }
  ]
});
```

Bento requires an email for every event. Pass it with each server call, and route anonymous page views to another provider:

```typescript
await serverAnalytics.track('subscription_renewed', { plan: 'pro' }, {
  user: { email: 'user@example.com' }
});
```

## What reaches Bento

- `identify()` sends `$update_fields`, so traits become subscriber fields. It does not send `$subscribe`. To subscribe someone, call the Bento SDK's `V1.addSubscriber()` directly.
- `track()` sends `$<event name>`. For example, `subscription_renewed` arrives as `$subscription_renewed`. The event timestamp becomes the Bento event `date`.
- `pageView()` sends `$view`.
- Failed requests, and events Bento does not queue, are logged without the event payload and are not thrown. Set `logErrors: true` to have the Bento SDK log the HTTP response of failed requests.

## Documentation

https://trakoo.co/docs/providers/bento
