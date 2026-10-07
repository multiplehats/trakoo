# @trakoo/openpanel

## 1.2.0

### Minor Changes

- Server `identify()` takes the request it came from: `identify(userId, traits, { context })`, merged with `defaultContext` the way `track()` merges it, and handed to providers as a new optional third argument of `AnalyticsProvider.identify`. Providers are called with two arguments, as before, when there is no context. The proxy server passes the browser's IP and user agent with every identify it ingests. ([#54](https://github.com/multiplehats/trakoo/pull/54))

  `@trakoo/openpanel`'s server provider forwards `context.server` (falling back to `context.device`) on identify as the `openpanel-client-ip` and `user-agent` headers. OpenPanel sets a profile's country, city, OS and browser from the request that identifies it, so before this every server-identified profile was placed where the server runs, typically the US, with no browser. With request context, an identify without traits is now sent to place the profile.

  `@trakoo/better-auth` identifies users with the request's IP and user agent, honoring Better Auth's `advanced.ipAddress` settings as its events already do.

## 1.1.0

### Minor Changes

- Server analytics supports groups, such as the company or workspace a user acts for. `group(type, id, traits?, { userId? })` creates or updates a group and adds the user to it, and `track()`'s `groups` option attributes an event to its groups by type (`{ company: "acme" }`). Providers opt in by implementing the new optional `group` method; routing calls it `"group"`, and a provider routed with `pii: false` receives the group's traits without personal keys such as `name`. A group type or id that is not a non-empty string fails validation with `invalid_options`. ([#52](https://github.com/multiplehats/trakoo/pull/52))

  `@trakoo/openpanel`'s server provider upserts the OpenPanel group (named by its `name` trait, or its id), assigns the profile to it, and sends each event's group ids as OpenPanel's `groups`, without keeping any group on the shared client between requests.

## 1.0.0

### Major Changes

- First release of the OpenPanel providers as their own package, moved out of trakoo core. Import `OpenPanelClientProvider` from `@trakoo/openpanel/client` and `OpenPanelServerProvider` from `@trakoo/openpanel/server`. ([#43](https://github.com/multiplehats/trakoo/pull/43))

  Changes from the trakoo 1.x providers:

  - A caller IP or user agent that cannot be sent as an HTTP header, such as one containing a line break, is skipped instead of making the server event retry and then fail as a network error. The proxy passes a browser-supplied `device.userAgent` through when the request has no user agent header, so a client could trigger this. A `device.ip` that cannot be sent is removed from the event's `device` properties, as a valid one already was, instead of being stored there.
  - The server provider passes only its documented options to the SDK. An untyped `waitForProfile` or `disabled` could previously queue events on the shared client and attribute one request's events to another user.
  - Both providers warn once at initialization when the installed SDK's transport is not recognized, instead of silently losing delivery-failure reporting and caller attribution.

### Patch Changes

- Updated dependencies [[`019013c`](https://github.com/multiplehats/trakoo/commit/019013c2f69cf7b10c21462f579c41b50e7a6223), [`019013c`](https://github.com/multiplehats/trakoo/commit/019013c2f69cf7b10c21462f579c41b50e7a6223)]:
  - trakoo@2.0.0
