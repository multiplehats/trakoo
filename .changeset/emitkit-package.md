---
"@trakoo/emitkit": major
---

First release of the EmitKit provider as its own package, moved out of trakoo core. Import `EmitKitServerProvider` from `@trakoo/emitkit/server`.

Changes from the trakoo 1.x provider:

- The visitor's IP address is removed from the `device` and `server` metadata, so it no longer appears in the EmitKit feed and its notifications.
- `identify()` without traits no longer sends empty `properties`, which EmitKit treats as replacing the stored profile. A non-string `email` trait is no longer sent as an alias, which EmitKit rejected.
- Tags are deduplicated and limited to 20 of at most 50 characters, and descriptions to 5000 characters, instead of EmitKit rejecting the whole event. The raw values stay in `metadata`.
- Requests time out after 5 seconds by default, as documented, instead of the SDK's 30 seconds.
- Events are labeled `source: "trakoo"` instead of `"stacksee-analytics"`.
- Failure logs include the EmitKit error class, status code and request ID.
