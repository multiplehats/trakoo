---
"@trakoo/emitkit": minor
---

An event can turn its push notification on or off with a boolean `__emitkit_notify` property, which overrides the provider's `notify` option for that event. Like `__emitkit_channel`, it is stripped from the event's metadata. Page views stay silent unless they set it.
