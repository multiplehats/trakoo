---
"@trakoo/emitkit": major
---

First release of the EmitKit provider as its own package, moved out of trakoo core. Import `EmitKitServerProvider` from `@trakoo/emitkit/server`.

Changes from the trakoo 1.x provider:

- Requires `@emitkit/js` 3 (`pnpm add @emitkit/js@next` until 3.0.0 is the stable release). The SDK retries network errors, timeouts, 5xx responses and short rate-limit waits twice, with an idempotency key so an event is never recorded twice.
- The visitor's IP address is removed from the `device` and `server` metadata, so it no longer appears in the EmitKit feed and its notifications.
- A non-string `email` trait is no longer sent as an alias, which EmitKit rejected.
- Tags are deduplicated and limited to 20 of at most 50 characters, and descriptions to 5000 characters. The raw values stay in `metadata`.
- Each request attempt times out after 5 seconds by default, as documented, instead of the SDK's 30 seconds.
- Events are labeled `source: "trakoo"` instead of `"stacksee-analytics"`.
- Failure logs include the EmitKit error code, HTTP status and request ID.
