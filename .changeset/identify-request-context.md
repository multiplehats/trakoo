---
"trakoo": minor
"@trakoo/openpanel": minor
"@trakoo/better-auth": minor
---

Server `identify()` takes the request it came from: `identify(userId, traits, { context })`, merged with `defaultContext` the way `track()` merges it, and handed to providers as a new optional third argument of `AnalyticsProvider.identify`. Providers are called with two arguments, as before, when there is no context. The proxy server passes the browser's IP and user agent with every identify it ingests.

`@trakoo/openpanel`'s server provider forwards `context.server` (falling back to `context.device`) on identify as the `openpanel-client-ip` and `user-agent` headers. OpenPanel sets a profile's country, city, OS and browser from the request that identifies it, so before this every server-identified profile was placed where the server runs, typically the US, with no browser. With request context, an identify without traits is now sent to place the profile.

`@trakoo/better-auth` identifies users with the request's IP and user agent, honoring Better Auth's `advanced.ipAddress` settings as its events already do.
