---
"@trakoo/emitkit": major
---

First release of the EmitKit provider as its own package, moved out of trakoo core. Import `EmitKitServerProvider` from `@trakoo/emitkit/server`.

Changes from the trakoo 1.x provider:

- Requires `@emitkit/js` 3.
- The visitor's IP address is removed from the `device` and `server` metadata, so it no longer appears in the EmitKit feed and its notifications.
- A non-string `email` trait is no longer sent as an alias, which EmitKit rejected.
- Duplicate tags are removed.
- Requests time out after 5 seconds by default, as documented, instead of the SDK's 30 seconds, and the SDK's retries are turned off so a call never waits longer than that.
- Events are labeled `source: "trakoo"` instead of `"stacksee-analytics"`.
- Failure logs include the EmitKit error code, HTTP status and request ID.
