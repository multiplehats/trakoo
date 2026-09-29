# @trakoo/emitkit

## 1.1.0

### Minor Changes

- An event can turn its push notification on or off with a boolean `__emitkit_notify` property, which overrides the provider's `notify` option for that event. Like `__emitkit_channel`, it is stripped from the event's metadata. Page views stay silent unless they set it. ([#45](https://github.com/multiplehats/trakoo/pull/45))

## 1.0.0

### Major Changes

- First release of the EmitKit provider as its own package, moved out of trakoo core. Import `EmitKitServerProvider` from `@trakoo/emitkit/server`. ([#43](https://github.com/multiplehats/trakoo/pull/43))

  Changes from the trakoo 1.x provider:

  - Requires `@emitkit/js` 3.
  - The visitor's IP address is removed from the `device` and `server` metadata, so it no longer appears in the EmitKit feed and its notifications.
  - A non-string `email` trait is no longer sent as an alias, which EmitKit rejected.
  - Duplicate tags are removed.
  - Requests time out after 5 seconds by default, as documented, instead of the SDK's 30 seconds, and the SDK's retries are turned off so a call never waits longer than that.
  - Events are labeled `source: "trakoo"` instead of `"stacksee-analytics"`.
  - Failure logs include the EmitKit error code, HTTP status and request ID.

### Patch Changes

- Updated dependencies [[`019013c`](https://github.com/multiplehats/trakoo/commit/019013c2f69cf7b10c21462f579c41b50e7a6223), [`019013c`](https://github.com/multiplehats/trakoo/commit/019013c2f69cf7b10c21462f579c41b50e7a6223)]:
  - trakoo@2.0.0
