<p align="center">
  <img src="./.github/assets/trakoo-logo.png" alt="trakoo" width="620">
</p>

# trakoo

A highly typed, zero-dependency, provider-agnostic analytics library for TypeScript applications. Works seamlessly on both client and server sides with full type safety for your custom events.

> **📚 [Full Documentation](https://trakoo.co/docs)** - For complete guides, examples, and provider setup, visit our documentation site.

## Quick Links

- 📖 [Documentation](https://trakoo.co/docs)
- 🚀 [Quick Start](https://trakoo.co/docs/quick-start)
- 🔌 [Providers](https://trakoo.co/docs/providers)
- 💡 [Core Concepts](https://trakoo.co/docs/core-concepts)

## Features

- 🎯 **Type-safe events**: Define your own strongly typed events with full IntelliSense support
- 🔌 **Plugin architecture**: Easily add analytics providers by passing them as plugins
- 🌐 **Universal**: Same API works on both client (browser) and server (Node.js)
- 👤 **User context**: Automatically attach user data (email, traits) to all events
- 🏗️ **Framework agnostic**: Use with any JavaScript framework. Can also be used only on the client.
- 🌎 **Edge ready**: The server client is compatible with edge runtime (e.g. Cloudflare Workers, Vercel Edge functions)
- 🔧 **Extensible**: Simple interface to add new providers

## Providers

The library includes built-in support for popular analytics services, with more coming soon:

### Official Providers

| Provider | Type | Documentation |
|----------|------|---------------|
| **PostHog** | Product Analytics | [View Docs](https://trakoo.co/docs/providers/posthog) |
| **OpenPanel** | Web & Product Analytics | [View Docs](https://trakoo.co/docs/providers/openpanel) |
| **Bento** | Email Marketing & Events | [View Docs](https://trakoo.co/docs/providers/bento) |
| **Pirsch** | Privacy-Focused Web Analytics | [View Docs](https://trakoo.co/docs/providers/pirsch) |

### Community & Custom Providers

Want to use a different analytics service? Check out our guide:

**[Creating Custom Providers →](https://trakoo.co/docs/providers/custom)**

You can easily create providers for:
- Google Analytics
- Mixpanel
- Amplitude
- Segment
- Customer.io
- Loops
- Any analytics service with a JavaScript SDK

**[View all provider documentation →](https://trakoo.co/docs/providers)**

## Installation

```bash
pnpm install trakoo

# For PostHog support
pnpm install posthog-js posthog-node

# For OpenPanel support
pnpm install @openpanel/web @openpanel/sdk

# For Bento support (server-side only)
pnpm install @bentonow/bento-node-sdk

# For Pirsch support
pnpm install pirsch-sdk
```

> **See also:** [Provider Documentation](https://trakoo.co/docs/providers) for detailed setup guides for each provider.

## Quick Start

### 1. Define Your Events

Create strongly typed events specific to your application:

```typescript
import { CreateEventDefinition, EventCollection } from 'trakoo';

export const appEvents = {
  userSignedUp: {
    name: 'user_signed_up',
    category: 'user',
    properties: {} as {
      userId: string;
      email: string;
      plan: 'free' | 'pro' | 'enterprise';
      referralSource?: string;
    }
  },

  featureUsed: {
    name: 'feature_used',
    category: 'engagement',
    properties: {} as {
      featureName: string;
      userId: string;
      duration?: number;
    }
  }
} as const satisfies EventCollection<Record<string, CreateEventDefinition<string>>>;

// Optionally extract types for use in your app
export type AppEvents = typeof appEvents;
export type AppEventName = keyof typeof appEvents;
export type AppEventProperties<T extends AppEventName> = typeof appEvents[T]['properties'];
```

Tip: If you have a lot of events, you can also divide your events into multiple files, then export them as a single object.

### 2. Client-Side Usage

```typescript
import { createClientAnalytics } from 'trakoo/client';
import { PostHogClientProvider } from 'trakoo/providers/client';
import type { AppEvents } from './events';

// Initialize analytics with providers as plugins
// Pass your event collection as a type parameter for full type safety
const analytics = createClientAnalytics<AppEvents>({
  providers: [
    new PostHogClientProvider({
      apiKey: 'your-posthog-api-key',
      host: 'https://app.posthog.com' // optional
    }),
    // Add more providers here as needed
  ],
  debug: true,
  enabled: true
});

// Track events with full type safety - event names and properties are typed!
analytics.track('user_signed_up', {
  userId: 'user-123',
  email: 'user@example.com',
  plan: 'pro',
  referralSource: 'google'
});

// TypeScript will error if you use wrong event names or properties
// analytics.track('wrong_event', {}); // ❌ Error: Argument of type '"wrong_event"' is not assignable
// analytics.track('user_signed_up', { wrongProp: 'value' }); // ❌ Error: Object literal may only specify known properties

// Identify users - user context is automatically included in all subsequent events
analytics.identify('user-123', {
  email: 'user@example.com',
  name: 'John Doe',
  plan: 'pro'
});

// Now all tracked events automatically include user context
analytics.track('feature_used', {
  featureName: 'export-data',
  userId: 'user-123'
});
// Providers receive: context.user = { userId: 'user-123', email: 'user@example.com', traits: {...} }
```

### 3. Server-Side Usage

```typescript
import { createServerAnalytics } from 'trakoo/server';
import { PostHogServerProvider } from 'trakoo/providers/server';
import type { AppEvents } from './events';

// Create analytics instance with providers as plugins
// Pass your event collection as a type parameter for full type safety
const analytics = createServerAnalytics<AppEvents>({
  providers: [
    new PostHogServerProvider({
      apiKey: process.env.POSTHOG_API_KEY,
      host: process.env.POSTHOG_HOST
    }),
    // Add more providers here as needed
  ],
  debug: process.env.NODE_ENV === 'development',
  enabled: true
});

// Track events with user context - now returns a Promise with full type safety
await analytics.track('feature_used', {
  featureName: 'export-data',
  userId: 'user-123',
  duration: 1500
}, {
  userId: 'user-123',
  user: {
    email: 'user@example.com',
    traits: {
      plan: 'pro',
      company: 'Acme Corp'
    }
  },
  context: {
    page: {
      path: '/api/export',
    }
  }
});
// Providers receive: context.user = { userId: 'user-123', email: 'user@example.com', traits: {...} }

// Important: Always call shutdown when done, some providers such as Posthog require flushing events.
await analytics.shutdown();
```

## User Context

The library automatically manages user context, making it easy to include user data (email, traits) in all your analytics events. This is especially useful for providers like Loops or Intercom that require user identifiers.

### How It Works

**Client-Side (Stateful):**
```typescript
// 1. Identify the user once (typically after login)
analytics.identify('user-123', {
  email: 'user@example.com',
  name: 'John Doe',
  plan: 'pro',
  company: 'Acme Corp'
});

// 2. Track events - user context is automatically included
analytics.track('button_clicked', { buttonId: 'checkout' });

// Behind the scenes, providers receive:
// {
//   event: { action: 'button_clicked', ... },
//   context: {
//     user: {
//       userId: 'user-123',
//       email: 'user@example.com',
//       traits: { email: '...', name: '...', plan: '...', company: '...' }
//     }
//   }
// }

// 3. Reset on logout to clear user context
analytics.reset();
```

**Server-Side (Stateless):**
```typescript
// Pass user context with each track call
await analytics.track('api_request', {
  endpoint: '/users',
  method: 'POST'
}, {
  userId: 'user-123',
  user: {
    email: 'user@example.com',
    traits: {
      plan: 'pro',
      company: 'Acme Corp'
    }
  }
});

// Alternatively, pass via context.user
await analytics.track('api_request', { ... }, {
  userId: 'user-123',
  context: {
    user: {
      email: 'user@example.com'
    }
  }
});
```

### Using User Context in Custom Providers

When building custom providers, you can access user context from the `EventContext`:

```typescript
export class LoopsProvider extends BaseAnalyticsProvider {
  name = 'Loops';

  async track(event: BaseEvent, context?: EventContext): Promise<void> {
    // Access user data from context
    const email = context?.user?.email;
    const userId = context?.user?.userId;
    const traits = context?.user?.traits;

    // Loops requires either email or userId
    if (!email && !userId) {
      this.log('Skipping event - Loops requires email or userId');
      return;
    }

    await this.loops.sendEvent({
      ...(email && { email }),
      ...(userId && { userId }),
      eventName: event.action,
      eventProperties: event.properties,
      // Optionally include all user traits
      contactProperties: traits,
    });
  }
}
```

### Security & Privacy

User context is handled securely:

- ✅ **Memory-only storage** - No localStorage, cookies, or persistence
- ✅ **Session-scoped** - Cleared on `reset()` (logout)
- ✅ **Provider-controlled** - Only sent to providers you configure
- ✅ **No cross-session leaks** - Fresh state on each page load

### Type-Safe User Traits

You can define a custom interface for your user traits to get full type safety:

```typescript
// Define your user traits interface
interface UserTraits {
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  company?: string;
  role?: 'admin' | 'user' | 'viewer';
}

// Client-side with typed traits
const analytics = createClientAnalytics<typeof AppEvents, UserTraits>({
  providers: [/* ... */]
});

// Now identify() and traits are fully typed!
analytics.identify('user-123', {
  email: 'user@example.com',
  name: 'John Doe',
  plan: 'pro',  // ✅ Autocomplete works!
  company: 'Acme Corp',
  role: 'admin'
});

// TypeScript will error on invalid trait values
analytics.identify('user-123', {
  plan: 'invalid'  // ❌ Error: Type '"invalid"' is not assignable to type 'free' | 'pro' | 'enterprise'
});

// Server-side with typed traits
const serverAnalytics = createServerAnalytics<typeof AppEvents, UserTraits>({
  providers: [/* ... */]
});

await serverAnalytics.track('event', {}, {
  user: {
    email: 'user@example.com',
    plan: 'pro',  // ✅ Fully typed!
    traits: {
      company: 'Acme Corp'
    }
  }
});
```

**Benefits:**
- ✅ Full IntelliSense/autocomplete for user traits
- ✅ Compile-time type checking prevents typos
- ✅ Self-documenting code
- ✅ Refactoring safety

### Client vs Server Differences

| Feature | Client (Browser) | Server (Node.js) |
|---------|------------------|------------------|
| **State Management** | Stateful - persists after `identify()` | Stateless - pass per request |
| **Usage Pattern** | Call `identify()` once, track many times | Pass `user` option with each `track()` |
| **Reset** | Call `reset()` on logout | No reset needed (stateless) |
| **Use Case** | Single user per session | Multiple users per instance |
| **Type Safety** | `createClientAnalytics<Events, Traits>` | `createServerAnalytics<Events, Traits>` |

### Async Tracking: When to await vs fire-and-forget

The `track()` method now returns a `Promise<void>`, giving you control over how to handle event tracking:

#### Fire-and-forget (Client-side typical usage)
```typescript
// Don't await - let events send in the background
analytics.track('button_clicked', {
  buttonId: 'checkout',
  label: 'Proceed to Checkout'
});

// User interaction continues immediately
```

#### Await for critical events (Server-side typical usage)
```typescript
// In serverless/edge functions, you have two patterns:

// Pattern 1: Critical events that MUST complete before response
export async function handler(req, res) {
  try {
    // Process payment
    const paymentResult = await processPayment(req.body);

    // For critical events like payments, await to ensure they're tracked
    // This blocks the response but guarantees the event is recorded
    await analytics.track('payment_processed', {
      amount: paymentResult.amount,
      currency: 'USD',
      userId: req.userId,
      transactionId: paymentResult.id
    });

    return res.json({ success: true, transactionId: paymentResult.id });
  } catch (error) {
    // Even on error, you might want to track
    await analytics.track('payment_failed', {
      error: error.message,
      userId: req.userId
    });

    return res.status(500).json({ error: 'Payment failed' });
  }
}

// Pattern 2: Non-critical events using waitUntil (Vercel example)
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  const startTime = Date.now();

  // Process request
  const result = await processRequest(req);

  // Track analytics in background without blocking response
  waitUntil(
    analytics.track('api_request', {
      endpoint: req.url,
      duration: Date.now() - startTime,
      userId: req.headers['x-user-id']
    }).then(() => analytics.shutdown())
  );

  // Response sent immediately
  return res.json(result);
}
```

#### Error handling
```typescript
// The track method catches provider errors internally and logs them
// It won't throw even if a provider fails, ensuring one provider's failure
// doesn't affect others

// If you need to know about failures, check your logs
await analytics.track('important_event', { data: 'value' });
// Even if one provider fails, others will still receive the event
```

#### Best practices:
- **Client-side**: Usually fire-and-forget for better UX
- **Server-side (serverless)**: Use `waitUntil` for non-critical events to avoid blocking responses
- **Server-side (long-running)**: Can await or fire-and-forget based on criticality
- **Critical events**: Always await (e.g., payments, sign-ups, conversions that must be recorded)
- **High-volume/non-critical events**: Use `waitUntil` in serverless or fire-and-forget in long-running servers
- **Error tracking**: Consider awaiting to ensure errors are captured before function terminates

### A complete example

Here's a complete example using Svelte 5 that demonstrates both client and server-side analytics for a waitlist signup:

```typescript
// src/lib/config/analytics.ts
import { createClientAnalytics } from 'trakoo/client';
import { PostHogClientProvider } from 'trakoo/providers/client';
import { PUBLIC_POSTHOG_API_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';

// Define your events for the waitlist
export const appEvents = {
  waitlistJoined: {
    name: 'waitlist_joined',
    category: 'user',
    properties: {} as {
      email: string;
      source: string; // e.g., 'homepage_banner', 'product_page_modal'
    }
  },
  waitlistApproved: {
    name: 'waitlist_approved',
    category: 'user',
    properties: {} as {
      userId: string; // This could be the email or a generated ID
      email: string;
    }
  }
} as const;

// Client-side analytics instance
export const clientAnalytics = createClientAnalytics<AppEvents>({
  providers: [
    new PostHogClientProvider({
      apiKey: PUBLIC_POSTHOG_API_KEY,
      host: PUBLIC_POSTHOG_HOST
    })
  ],
  debug: import.meta.env.DEV
});
```

```typescript
// src/lib/server/analytics.ts
import { createServerAnalytics } from 'trakoo/server';
import { PostHogServerProvider } from 'trakoo/providers/server';
import { AppEvents } from '$lib/config/analytics'; // Import AppEvents
import { PUBLIC_POSTHOG_API_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';

export const serverAnalytics = createServerAnalytics<AppEvents>({
  providers: [
    new PostHogServerProvider({
      apiKey: PUBLIC_POSTHOG_API_KEY,
      host: PUBLIC_POSTHOG_HOST
    })
  ],
  debug: import.meta.env.DEV
});
```

```svelte
<!-- src/routes/join-waitlist/+page.svelte -->
<script lang="ts">
  import { clientAnalytics } from '$lib/config/analytics';

  let email = $state('');
  let loading = $state(false);
  let message = $state('');

  async function handleWaitlistSubmit(event: Event) {
    event.preventDefault();
    loading = true;
    message = '';

    try {
      // Track waitlist joined event on the client
      clientAnalytics.track('waitlist_joined', {
        email,
        source: 'waitlist_page_form'
      });

      // Submit email to the server
      const response = await fetch('/api/join-waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to join waitlist');
      }

      message = 'Successfully joined the waitlist! We will notify you once you are approved.';
    } catch (error) {
      console.error('Waitlist submission failed:', error);
      message = error instanceof Error ? error.message : 'An unexpected error occurred.';
    } finally {
      loading = false;
    }
  }
</script>

<h2>Join Our Waitlist</h2>
<form onsubmit={handleWaitlistSubmit}>
  <label>
    Email:
    <input
      type="email"
      bind:value={email}
      placeholder="you@example.com"
      required
      disabled={loading}
    />
  </label>
  <button type="submit" disabled={loading}>
    {loading ? 'Joining...' : 'Join Waitlist'}
  </button>
</form>

{#if message}
  <p>{message}</p>
{/if}
```

```typescript
// src/routes/api/join-waitlist/+server.ts
import { serverAnalytics } from '$lib/server/analytics';
import { json, type RequestHandler } from '@sveltejs/kit';

async function approveUserForWaitlist(email: string): Promise<{ userId: string }> {
  console.log(`Processing waitlist application for: ${email}`);

  const userId = `user_${Date.now()}_${email.split('@')[0]}`;

  return { userId };
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const email = body.email;

    if (!email || typeof email !== 'string') {
      return json({ success: false, message: 'Email is required' }, { status: 400 });
    }

    const { userId } = await approveUserForWaitlist(email);

    serverAnalytics.track('waitlist_approved', {
      userId,
      email
    }, {
      userId,
      context: {
        page: {
          path: '/api/join-waitlist'
        },
        ip: request.headers.get('x-forwarded-for') || undefined
      }
    });

    // Important: Call shutdown if your application instance is short-lived. (e.g. serverless function)
    // For long-running servers, you might call this on server shutdown.
    await serverAnalytics.shutdown();

    return json({ success: true, userId, message: 'Successfully joined and approved for waitlist.' });
  } catch (error) {
    console.error('Failed to process waitlist application:', error);
    // In production, be careful about leaking error details
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return json({ success: false, message: errorMessage }, { status: 500 });
  }
  // Note: serverAnalytics.shutdown() should ideally be called when the server itself is shutting down,
  // not after every request in a typical web server setup, unless the provider requires it for batching.
  // For this example, PostHogServerProvider benefits from shutdown to flush events,
  // so if this were, for example, a serverless function processing one event, calling shutdown would be appropriate.
  // If it's a long-running server, manage shutdown centrally.
};
```

#### Note for SvelteKit Users: Navigation Tracking

If you're using SvelteKit and want to track page views and page leaves automatically with PostHog (as recommended in their documentation), add this to your root layout:

```typescript
// src/app.html or src/routes/+layout.svelte
<script>
  import { pageView, pageLeave } from 'trakoo/client';
  import { beforeNavigate, afterNavigate } from '$app/navigation';
  import { browser } from '$app/environment';

  let { children } = $props():

  // Only set up navigation tracking in the browser
  if (browser) {
    beforeNavigate(() => {
      pageLeave();
    });

    afterNavigate(() => {
      pageView();
    });
  }
</script>

<main>
  {@render children()}
</main>
```

This automatically tracks:
- **Page leaves** before navigation (`$pageleave` events in PostHog)
- **Page views** after navigation (`$pageview` events in PostHog)

The tracking is framework-agnostic, so you can use similar patterns with Next.js router events, Vue Router hooks, or any other navigation system.

### Event Categories

Event categories help organize your analytics data. The SDK provides predefined categories with TypeScript autocomplete:

- `product` - Product-related events (views, purchases, etc.)
- `user` - User lifecycle events (signup, login, profile updates)
- `navigation` - Page views and navigation events
- `conversion` - Conversion and goal completion events
- `engagement` - Feature usage and interaction events
- `error` - Error tracking events
- `performance` - Performance monitoring events

You can also use **custom categories** for your specific needs:

```typescript
export const appEvents = {
  aiResponse: {
    name: 'ai_response_generated',
    category: 'ai', // Custom category
    properties: {} as {
      model: string;
      responseTime: number;
      tokensUsed: number;
    }
  },

  customWorkflow: {
    name: 'workflow_completed',
    category: 'workflow', // Another custom category
    properties: {} as {
      workflowId: string;
      duration: number;
      steps: number;
    }
  }
} as const satisfies EventCollection<Record<string, CreateEventDefinition<string>>>;
```

### Adding Custom Providers

Want to integrate with a different analytics service? See our comprehensive guide:

**[Creating Custom Providers →](https://trakoo.co/docs/providers/custom)**

Quick example:

```typescript
import { BaseAnalyticsProvider, BaseEvent, EventContext } from 'trakoo';

export class GoogleAnalyticsProvider extends BaseAnalyticsProvider {
  name = 'GoogleAnalytics';

  async initialize(): Promise<void> { /* Initialize GA */ }
  track(event: BaseEvent, context?: EventContext): void { /* Track event */ }
  identify(userId: string, traits?: Record<string, unknown>): void { /* Identify user */ }
  // ... implement other required methods
}
```

Then use it as a plugin in your configuration:

```typescript
const analytics = createClientAnalytics<typeof AppEvents>({
  providers: [
    new PostHogClientProvider({ token: 'xxx' }),
    new GoogleAnalyticsProvider({ measurementId: 'xxx' })
  ]
});
```

### Client-Only and Server-Only Providers

**Important**: To avoid bundling Node.js dependencies in your client code, always use the environment-specific provider imports:

- **Client-side**: `trakoo/providers/client` - Only includes browser-compatible providers
- **Server-side**: `trakoo/providers/server` - Only includes Node.js providers
- **Both**: `trakoo/providers` - Includes all providers (may cause bundling issues in browsers)

Some analytics libraries are designed to work only in specific environments. For example:
- **Client-only**: Google Analytics (gtag.js), Hotjar, FullStory
- **Server-only**: Some enterprise analytics APIs that require secret keys
- **Universal**: PostHog, Segment (have separate client/server SDKs)

The library handles this by having separate provider implementations for client and server environments:

```typescript
// Client-side provider for a client-only analytics service
import { BaseAnalyticsProvider, BaseEvent, EventContext } from 'trakoo';

export class MixpanelClientProvider extends BaseAnalyticsProvider {
  name = 'Mixpanel-Client';

  constructor(config: { projectToken: string }) {
    super();
    // Initialize Mixpanel browser SDK
  }

  // ... implement required methods
}

// Server-side provider for a server-only analytics service
export class MixpanelServerProvider extends BaseAnalyticsProvider {
  name = 'Mixpanel-Server';

  constructor(config: { projectToken: string; apiSecret: string }) {
    super();
    // Initialize Mixpanel server SDK with secret
  }

  // ... implement required methods
}
```

Then use the appropriate provider based on your environment:

```typescript
// Client-side usage
import { createClientAnalytics } from 'trakoo/client';
import { MixpanelClientProvider } from './providers/mixpanel-client';

const clientAnalytics = createClientAnalytics<typeof AppEvents>({
  providers: [
    new MixpanelClientProvider({ projectToken: 'xxx' })
  ]
});

// Server-side usage
import { createServerAnalytics } from 'trakoo/server';
import { MixpanelServerProvider } from './providers/mixpanel-server';

const serverAnalytics = createServerAnalytics<typeof AppEvents>({
  providers: [
    new MixpanelServerProvider({
      projectToken: 'xxx',
      apiSecret: 'secret-xxx' // Server-only configuration
    })
  ]
});
```

**Important notes:**
- Client providers should only use browser-compatible APIs
- Server providers can use Node.js-specific features and secret credentials
- The provider interface is the same, ensuring consistent usage patterns
- Import paths are separate (`/client` vs `/server`) to prevent accidental usage in wrong environments

### Using Multiple Providers

The plugin architecture makes it easy to send events to multiple analytics services simultaneously:

```typescript
import { createClientAnalytics } from 'trakoo/client';
import { PostHogClientProvider } from 'trakoo/providers/client';
// Import your custom providers
import { GoogleAnalyticsProvider } from './providers/google-analytics';
import { MixpanelProvider } from './providers/mixpanel';

const analytics = createClientAnalytics<typeof AppEvents>({
  providers: [
    // PostHog for product analytics
    new PostHogClientProvider({
      apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
      host: 'https://app.posthog.com'
    }),

    // Google Analytics for marketing insights
    new GoogleAnalyticsProvider({
      measurementId: process.env.NEXT_PUBLIC_GA_ID
    }),

    // Mixpanel for detailed user journey analysis
    new MixpanelProvider({
      projectToken: process.env.NEXT_PUBLIC_MIXPANEL_TOKEN
    })
  ],
  debug: process.env.NODE_ENV === 'development',
  enabled: true
});

// All providers will receive this event
analytics.track('user_signed_up', {
  userId: 'user-123',
  plan: 'pro'
});
```

## Server Deployments and waitUntil

When deploying your application to serverless environments, it's important to handle analytics events properly to ensure they are sent before the function terminates. Different platforms provide their own mechanisms for this:

### Vercel Functions

Vercel provides a `waitUntil` API that allows you to continue processing after the response has been sent:

```typescript
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  const analytics = createServerAnalytics<typeof AppEvents>({
    providers: [new PostHogServerProvider({ apiKey: process.env.POSTHOG_API_KEY })]
  });

  // Process your request and prepare response
  const result = { success: true, data: 'processed' };

  // Use waitUntil to track events and flush without blocking the response
  waitUntil(
    analytics.track('api_request', {
      endpoint: '/api/users',
      method: 'POST',
      statusCode: 200,
      responseTime: 150
    }).then(() => analytics.shutdown())
  );

  // Response is sent immediately, tracking happens in background
  res.status(200).json(result);
}
```

### Cloudflare Workers

Cloudflare Workers provides a `waitUntil` method on the execution context:

```typescript
export default {
  async fetch(request, env, ctx) {
    const analytics = createServerAnalytics<typeof AppEvents>({
      providers: [new PostHogServerProvider({ apiKey: env.POSTHOG_API_KEY })]
    });

    // Process request and prepare response
    const response = new Response('OK', { status: 200 });

    // Use ctx.waitUntil to track events and flush without blocking the response
    ctx.waitUntil(
      analytics.track('worker_execution', {
        url: request.url,
        method: request.method,
        cacheStatus: 'MISS',
        executionTime: 45
      }).then(() => analytics.shutdown())
    );

    // Response is returned immediately, tracking happens in background
    return response;
  }
};
```

### Netlify Functions

Netlify Functions also support `waitUntil` through their context object:

```typescript
export async function handler(event, context) {
  const analytics = createServerAnalytics<AppEvents>({
    providers: [new PostHogServerProvider({ apiKey: process.env.POSTHOG_API_KEY })]
  });

  const responseBody = { success: true, data: 'processed' };

  // Use context.waitUntil to track events and flush without blocking the response
  context.waitUntil(
    analytics.track('function_invocation', {
      path: event.path,
      httpMethod: event.httpMethod,
      queryStringParameters: event.queryStringParameters,
      executionTime: 120
    }).then(() => analytics.shutdown())
  );

  // Response is returned immediately, tracking happens in background
  return {
    statusCode: 200,
    body: JSON.stringify(responseBody)
  };
}
```

**Important Notes:**
1. Always call `analytics.shutdown()` within `waitUntil` to ensure events are sent
2. The `waitUntil` API is platform-specific, so make sure to use the correct import/usage for your deployment platform
3. For long-running servers (not serverless), you should call `shutdown()` when the server itself is shutting down
4. Some providers may batch events, so `shutdown()` ensures all pending events are sent

## API Reference

### Client API

#### `createClientAnalytics<TEvents>(config)`
Initialize analytics for browser environment with optional type-safe events.

- `TEvents` - (optional) Your event collection type for full type safety
- `config.providers` - Array of analytics provider instances
- `config.debug` - Enable debug logging
- `config.enabled` - Enable/disable analytics

```typescript
const analytics = createClientAnalytics<typeof AppEvents>({
  providers: [/* ... */],
  debug: true,
  enabled: true
});
```

#### `BrowserAnalytics<TEventMap>`
- `track(eventName, properties): Promise<void>` - Track an event with type-safe event names and properties. User context from `identify()` is automatically included.
- `identify(userId, traits)` - Identify a user and store their traits. All subsequent `track()` calls will include this user context.
- `pageView(properties)` - Track a page view
- `pageLeave(properties)` - Track a page leave event
- `reset()` - Reset user session, clearing userId and user traits
- `updateContext(context)` - Update event context

### Server API

#### `createServerAnalytics<TEvents>(config)`
Create analytics instance for server environment with optional type-safe events.

- `TEvents` - (optional) Your event collection type for full type safety
- `config.providers` - Array of analytics provider instances
- `config.debug` - Enable debug logging
- `config.enabled` - Enable/disable analytics

```typescript
const analytics = createServerAnalytics<AppEvents>({
  providers: [/* ... */],
  debug: true,
  enabled: true
});
```

#### `ServerAnalytics<TEventMap>`
- `track(eventName, properties, options): Promise<void>` - Track an event with type-safe event names and properties. Pass user context via `options.user` or `options.context.user`.
  - `options.userId` - User ID for this event
  - `options.sessionId` - Session ID for this event
  - `options.user` - User context (email, traits) for this event
  - `options.context` - Additional event context (page, device, etc.)
- `identify(userId, traits)` - Identify a user (sends to providers but doesn't persist on server)
- `pageView(properties, options)` - Track a page view
- `pageLeave(properties, options)` - Track a page leave event
- `shutdown()` - Flush pending events and cleanup

### Type Helpers

- `CreateEventDefinition<TName, TProperties>` - Define a single event
- `EventCollection<T>` - Define a collection of events
- `ExtractEventNames<T>` - Extract event names from a collection
- `ExtractEventPropertiesFromCollection<T, TEventName>` - Extract properties for a specific event

## Best Practices

1. **Define events in a central location** - Keep all event definitions in one file for consistency
2. **Use const assertions** - Use `as const` for better type inference
3. **Initialize early** - Initialize analytics as early as possible in your app lifecycle
4. **Handle errors gracefully** - Analytics should never break your app
5. **Respect privacy** - Implement user consent and opt-out mechanisms
6. **Test your events** - Verify events are tracked correctly in development
7. **Document events** - Add comments to explain when each event should be fired
8. **Create provider instances once** - Reuse provider instances across your app

---

## Learn More

This README provides a quick overview. For comprehensive documentation, guides, and examples:

**📚 [Visit the Full Documentation](https://trakoo.co/docs)**

- [Quick Start Guide](https://trakoo.co/docs/quick-start)
- [Core Concepts](https://trakoo.co/docs/core-concepts)
- [Provider Setup Guides](https://trakoo.co/docs/providers)
- [Framework Guides](https://trakoo.co/docs/guides)

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT
