---
"trakoo": minor
---

Provider routing takes `pii: false` to keep personal data from a provider. That provider never receives the `email`, `name`, `firstName`, `lastName` or `phone` traits in `identify()`, nor the email or those traits in an event's user context, while other providers still do. It works in both client and server analytics.

`defineEvents({ ...otherRegistry, ...events })` now type-checks: spreading a registry no longer carries its internal brand into the new registry's definitions, so packages can ship events for you to merge.
