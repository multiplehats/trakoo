# @trakoo/openpanel

OpenPanel providers for [trakoo](https://www.npmjs.com/package/trakoo), the typed, provider-agnostic analytics library.

## Installation

Install the package with only the OpenPanel SDK for the side you use:

```bash
# Browser
pnpm add trakoo @trakoo/openpanel @openpanel/web

# Server
pnpm add trakoo @trakoo/openpanel @openpanel/sdk
```

## Usage

`appEvents` is your event registry, created with `defineEvents()` from `trakoo`.

```typescript title="lib/analytics.ts"
import { createClientAnalytics } from 'trakoo/client';
import { OpenPanelClientProvider } from '@trakoo/openpanel/client';
import { appEvents } from './events';

export const analytics = createClientAnalytics({
  events: appEvents,
  providers: [
    new OpenPanelClientProvider({
      clientId: import.meta.env.VITE_OPENPANEL_CLIENT_ID
    })
  ]
});
```

```typescript title="lib/server-analytics.ts"
import { createServerAnalytics } from 'trakoo/server';
import { OpenPanelServerProvider } from '@trakoo/openpanel/server';
import { appEvents } from './events';

export const serverAnalytics = createServerAnalytics({
  events: appEvents,
  providers: [
    new OpenPanelServerProvider({
      clientId: process.env.OPENPANEL_CLIENT_ID!,
      clientSecret: process.env.OPENPANEL_CLIENT_SECRET!
    })
  ]
});
```

Never put the client secret in browser code; `OpenPanelClientProvider` does not accept one.

## Documentation

https://trakoo.co/docs/providers/openpanel
