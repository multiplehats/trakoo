# @trakoo/emitkit

EmitKit server provider for [trakoo](https://www.npmjs.com/package/trakoo), the typed, provider-agnostic analytics library.

## Installation

```bash
pnpm add trakoo @trakoo/emitkit @emitkit/js
```

## Usage

`appEvents` is your event registry, created with `defineEvents()` from `trakoo`.

```typescript title="lib/server-analytics.ts"
import { createServerAnalytics } from 'trakoo/server';
import { EmitKitServerProvider } from '@trakoo/emitkit/server';
import { appEvents } from './events';

export const serverAnalytics = createServerAnalytics({
  events: appEvents,
  providers: [
    new EmitKitServerProvider({
      apiKey: process.env.EMITKIT_API_KEY!,
      channelName: 'general',
      categoryChannelMap: {
        user: 'user-activity',
        conversion: 'revenue'
      }
    })
  ]
});
```

EmitKit is server-only. To send browser events to it, forward them through trakoo's [Proxy provider](https://trakoo.co/docs/providers/proxy).

The provider also sends page views, as silent events. EmitKit allows 100 requests per minute per API key by default, so if you only want explicit events in your feeds, register it as `{ provider: new EmitKitServerProvider({ ... }), exclude: ['pageView'] }`.

## Documentation

https://trakoo.co/docs/providers/emitkit
