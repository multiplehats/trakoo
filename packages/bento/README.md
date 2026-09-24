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

## Documentation

https://trakoo.co/docs/providers/bento
