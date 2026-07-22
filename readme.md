<p align="center">
  <img src="./.github/assets/trakoo-logo.png" alt="trakoo" width="620">
</p>

# trakoo

A typed, provider-agnostic analytics library for TypeScript applications. Define one event registry, create an application-owned client or server instance, and send the same events to any configured provider.

> **[Read the full documentation](https://trakoo.co/docs)** for framework guides and provider-specific setup.

## Features

- Event names and properties inferred from one registry
- Validator-free TypeScript definitions with optional Standard Schema validation
- Separate browser and server entry points
- Typed user traits and per-event user context
- Provider fan-out and routing
- Fresh, independently configured analytics instances

## Installation

```bash
pnpm install trakoo
```

Install only the SDKs required by your providers. For example:

```bash
pnpm install posthog-js posthog-node
```

## Quick start

### 1. Define events

The root `trakoo` entry point contains environment-neutral event helpers and shared types.

```typescript title="lib/events.ts"
import { defineEvents, noProperties, typed } from 'trakoo';

export const appEvents = defineEvents({
  userSignedUp: {
    name: 'user_signed_up',
    category: 'user',
    properties: typed<{
      userId: string;
      email: string;
      plan: 'free' | 'pro' | 'enterprise';
      referralSource?: string;
    }>()
  },
  featureUsed: {
    name: 'feature_used',
    category: 'engagement',
    properties: typed<{
      featureName: string;
      duration?: number;
    }>()
  },
  sessionStarted: {
    name: 'session_started',
    category: 'user',
    properties: noProperties()
  }
});
```

`typed<T>()` gives you compile-time checking without a runtime validator. It verifies at runtime only that a property-bearing event receives a non-array object. Use `noProperties()` when callers must omit the properties argument entirely.

### 2. Create a client instance

Factories and providers come from environment-specific subpaths. Pass the registry as a value; no event generic is needed.

```typescript title="lib/analytics.ts"
import { createClientAnalytics } from 'trakoo/client';
import { PostHogClientProvider } from 'trakoo/providers/client';
import { appEvents } from './events';

export const analytics = createClientAnalytics({
  events: appEvents,
  providers: [
    new PostHogClientProvider({
      token: import.meta.env.VITE_POSTHOG_KEY,
      api_host: import.meta.env.VITE_POSTHOG_HOST
    })
  ],
  debug: import.meta.env.DEV
});
```

Each factory call returns a fresh instance. trakoo does not keep a global analytics singleton. Create and own the instance in your application, then import that owned instance where you track.

```typescript
analytics.track('user_signed_up', {
  userId: 'user-123',
  email: 'ada@example.com',
  plan: 'pro'
});

analytics.track('session_started');
```

The registry drives autocomplete and rejects misspelled names, missing properties, extra properties, and a properties argument for `session_started`.

### 3. Create a server instance

```typescript title="lib/server-analytics.ts"
import { createServerAnalytics } from 'trakoo/server';
import { PostHogServerProvider } from 'trakoo/providers/server';
import { appEvents } from './events';

export const serverAnalytics = createServerAnalytics({
  events: appEvents,
  providers: [
    new PostHogServerProvider({
      apiKey: process.env.POSTHOG_API_KEY!,
      host: process.env.POSTHOG_HOST
    })
  ]
});
```

Server tracking accepts user and request context per call:

```typescript
await serverAnalytics.track('feature_used', {
  featureName: 'export-data',
  duration: 1500
}, {
  userId: 'user-123',
  user: {
    email: 'ada@example.com',
    traits: { plan: 'pro' }
  },
  context: {
    page: { path: '/api/export' }
  }
});

await serverAnalytics.shutdown();
```

Call `shutdown()` before a serverless request or worker exits so providers can flush queued events.

## Runtime validation with Standard Schema

Standard Schema is an interface implemented by validator libraries; it is not a validator runtime that trakoo requires. The primary API remains validator-free `typed<T>()`. When an event crosses an untrusted boundary, pass a compatible validator directly. Zod implements Standard Schema:

```typescript
import { defineEvents } from 'trakoo';
import { z } from 'zod';

export const commerceEvents = defineEvents({
  orderCompleted: {
    name: 'order_completed',
    category: 'conversion',
    properties: z.object({
      orderId: z.string(),
      amount: z.coerce.number().positive()
    })
  }
});
```

The schema's input type controls what `track()` accepts. Its output type controls the validated and transformed properties passed to providers. In this example, `amount` may be a coercible input, but providers always receive a positive number.

Validation failures are dropped by default. For strict handling, opt into throwing and report the sanitized error:

```typescript
const analytics = createClientAnalytics({
  events: commerceEvents,
  providers: [/* ... */],
  validation: {
    onFailure: 'throw',
    onError: (error) => reportValidationFailure(error)
  }
});
```

`AnalyticsValidationError` contains a code, event name, and normalized issue messages/paths. It never retains the event payload. With `debug: true` and no `onError`, the fallback warning contains only the code, event name, and issue paths, so invalid values are not logged.

The error callback is awaited before the configured drop or throw policy is applied. Async schemas also mean concurrent `track()` calls can reach providers in validation-completion order rather than call order. Await calls sequentially if delivery order matters.

This validation policy applies only to event lookup and property validation. Initialization failures and provider failures keep their existing behavior.

## Typed user traits

Use another `typed<T>()` marker for custom traits. The factory still infers the event registry from `events`.

```typescript
import { typed } from 'trakoo';
import { createClientAnalytics } from 'trakoo/client';
import { appEvents } from './events';

interface UserTraits {
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  company?: string;
}

export const analytics = createClientAnalytics({
  events: appEvents,
  userTraits: typed<UserTraits>(),
  providers: [/* ... */]
});

analytics.identify('user-123', {
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  plan: 'pro'
});
```

Client analytics remembers the identified user until `reset()`. Server analytics is stateless: pass `userId` and `user` with each `track()` call.

## Multiple providers and routing

```typescript
const analytics = createClientAnalytics({
  events: appEvents,
  providers: [
    new PostHogClientProvider({ token: 'posthog-token' }),
    {
      provider: new BentoClientProvider({ siteUuid: 'bento-site' }),
      methods: ['identify', 'track'],
      events: ['user_signed_up']
    },
    new VisitorsClientProvider({ token: 'visitors-token' })
  ]
});
```

Every configured provider receives eligible calls. Routing can restrict methods, exact event names, excluded events, or event-name patterns.

## Custom providers

Extend the base class from the environment where the provider will run:

```typescript
import {
  BaseAnalyticsProvider,
  type BaseEvent,
  type EventContext
} from 'trakoo/client';

export class ConsoleProvider extends BaseAnalyticsProvider {
  name = 'Console';

  initialize() {}
  identify(userId: string, traits?: Record<string, unknown>) {
    console.log('identify', { userId, traits });
  }
  track(event: BaseEvent, context?: EventContext) {
    console.log('track', { event, context });
  }
  pageView(properties?: Record<string, unknown>) {
    console.log('page view', properties);
  }
  reset() {}
}
```

See [Creating Custom Providers](https://trakoo.co/docs/providers/custom) for the full lifecycle.

## Import map

| Import | Contents |
|---|---|
| `trakoo` | `defineEvents`, `typed`, `noProperties`, validation error, and shared types |
| `trakoo/client` | Client factory, browser analytics class, client-safe base provider exports |
| `trakoo/server` | Server factory, server analytics class, server-safe base provider exports |
| `trakoo/providers/client` | Browser provider implementations |
| `trakoo/providers/server` | Server provider implementations |

Do not import factories from the root or use a combined provider entry point.

## API summary

### `defineEvents(definitions)`

Creates the branded runtime registry required by both factories. Duplicate wire names throw while the registry is created.

### `typed<T>()`

Declares an object-shaped compile-time input/output type without validating its fields at runtime.

### `noProperties()`

Declares an event that must be tracked without a properties argument.

### `createClientAnalytics(config)`

Requires `config.events`. Optional configuration includes `providers`, `userTraits`, `validation`, `debug`, and `enabled`. Returns a fresh client instance.

### `createServerAnalytics(config)`

Requires `config.events`. Optional configuration includes `providers`, `userTraits`, `validation`, `debug`, `enabled`, and `defaultContext`. Returns a fresh server instance.

## Best practices

1. Keep a single authoritative registry and pass that registry value to every analytics factory.
2. Prefer `typed<T>()`; add a Standard Schema validator only at boundaries that need runtime checking or transformation.
3. Model zero-property events with `noProperties()`.
4. Create analytics and provider instances in application-owned modules; do not rely on hidden global state.
5. Use client/server subpaths so environment-specific code stays out of the wrong bundle.
6. Await server events and call `shutdown()` when delivery must complete before the runtime exits.
7. Never send secrets or unnecessary personal data to analytics providers.

## Learn more

- [Quick Start](https://trakoo.co/docs/quick-start)
- [Core Concepts](https://trakoo.co/docs/core-concepts)
- [Provider Setup](https://trakoo.co/docs/providers)
- [Framework Guides](https://trakoo.co/docs/guides)

## Contributing

Contributions are welcome. Please open an issue or pull request with a focused description and tests where behavior changes.
