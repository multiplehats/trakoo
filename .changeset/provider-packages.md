---
"trakoo": major
---

Move the SDK-backed providers into their own packages so installing one provider never involves another provider's SDK

Core declared every provider SDK as an optional peer. npm checks an optional peer whenever that package is already installed, so an OpenPanel user who had `posthog-node@4` for unrelated reasons could not install trakoo at all (`ERESOLVE ... peerOptional posthog-node@"^5.9.0"`). The PostHog config types re-exported from `trakoo/client` and `trakoo/server` also failed to resolve under `skipLibCheck: false` unless PostHog was installed.

Core now declares no provider SDK. Install the adapter for each SDK-backed provider next to its SDK:

| Provider | Before | After |
| --- | --- | --- |
| PostHog | `trakoo/providers/client`, `trakoo/providers/server`, `trakoo/client`, `trakoo/server` | `@trakoo/posthog/client`, `@trakoo/posthog/server` |
| OpenPanel | `trakoo/providers/client`, `trakoo/providers/server` | `@trakoo/openpanel/client`, `@trakoo/openpanel/server` |
| Bento (server) | `trakoo/providers/server` | `@trakoo/bento/server` |
| EmitKit | `trakoo/providers/server` | `@trakoo/emitkit/server` |

`PostHogConfig`, `PostHogOptions`, the OpenPanel delivery-failure types and `BentoAnalyticsOptions` moved with their providers. Bento's browser provider, Pirsch, Visitors and the proxy need no SDK and stay in `trakoo/providers/*`. `BaseAnalyticsProvider` is now also exported from the root `trakoo` entry.
