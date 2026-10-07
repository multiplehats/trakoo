# @trakoo/better-auth

## 1.1.0

### Minor Changes

- Server `identify()` takes the request it came from: `identify(userId, traits, { context })`, merged with `defaultContext` the way `track()` merges it, and handed to providers as a new optional third argument of `AnalyticsProvider.identify`. Providers are called with two arguments, as before, when there is no context. The proxy server passes the browser's IP and user agent with every identify it ingests. ([#54](https://github.com/multiplehats/trakoo/pull/54))

  `@trakoo/openpanel`'s server provider forwards `context.server` (falling back to `context.device`) on identify as the `openpanel-client-ip` and `user-agent` headers. OpenPanel sets a profile's country, city, OS and browser from the request that identifies it, so before this every server-identified profile was placed where the server runs, typically the US, with no browser. With request context, an identify without traits is now sent to place the profile.

  `@trakoo/better-auth` identifies users with the request's IP and user agent, honoring Better Auth's `advanced.ipAddress` settings as its events already do.

## 1.0.0

### Major Changes

- First release of `@trakoo/better-auth`, a Better Auth plugin that sends typed trakoo events for auth lifecycle changes: sign-ups, sign-ins, sign-outs, sessions, password and email changes, organizations, members, invitations and teams, API keys, admin actions, two-factor, passkeys, anonymous users, SSO providers and Stripe subscriptions. Merge its `authEvents` registry into your own and add `trakooAuth({ analytics })` last in Better Auth's `plugins`. ([#45](https://github.com/multiplehats/trakoo/pull/45))

  - Registers events only for the Better Auth plugins you install, and team events only when teams are enabled.
  - Reports database changes after their transaction commits, and nothing for failed requests.
  - Identifies users on sign-up, sign-in and profile or email changes. Email and name go only through identify, plus the email on `user_signed_up`'s user context for email tools such as Bento.
  - Never sends passwords, tokens, API key values, OTPs or 2FA secrets.
  - Sends events after the response, through Better Auth's `advanced.backgroundTasks.handler` or Vercel's `waitUntil`, and never throws into Better Auth.
  - Sets EmitKit channel and notify hints on every event.

  Requires `better-auth` 1.7 or later.
