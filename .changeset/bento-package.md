---
"@trakoo/bento": major
---

First release of the Bento server provider as its own package, moved out of trakoo core. Import `BentoServerProvider` from `@trakoo/bento/server`; Bento's browser provider stays in `trakoo/providers/client`. Supports `@bentonow/bento-node-sdk` 0.2 and 2.x.

Changes from the trakoo 1.x provider:

- `identify()` updates the subscriber's fields with `$update_fields` instead of sending `$subscribe`, which subscribed the person to marketing email and re-ran subscribe automations on every call. Call Bento's `V1.addSubscriber()` directly to subscribe someone.
- `track()` sends the event time as Bento's event `date`.
- An event that Bento accepts without queueing is logged as a failure instead of as tracked.
