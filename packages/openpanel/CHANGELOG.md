# @trakoo/openpanel

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
