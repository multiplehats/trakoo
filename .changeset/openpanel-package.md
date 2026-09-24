---
"@trakoo/openpanel": major
---

First release of the OpenPanel providers as their own package, moved out of trakoo core. Import `OpenPanelClientProvider` from `@trakoo/openpanel/client` and `OpenPanelServerProvider` from `@trakoo/openpanel/server`.

Changes from the trakoo 1.x providers:

- A caller IP or user agent that cannot be sent as an HTTP header, such as one containing a line break, is skipped instead of making the server event retry and then fail as a network error. The proxy passes a browser-supplied `device.userAgent` through when the request has no user agent header, so a client could trigger this.
- The server provider passes only its documented options to the SDK. An untyped `waitForProfile` or `disabled` could previously queue events on the shared client and attribute one request's events to another user.
- Both providers warn once at initialization when the installed SDK's transport is not recognized, instead of silently losing delivery-failure reporting and caller attribution.
