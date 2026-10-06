---
"trakoo": minor
---

Server `track()` takes an `occurredAt` option, a `Date` or epoch milliseconds, for an event recorded after it happened, such as a backfill or a projection of stored records. Providers receive it as the event's timestamp: OpenPanel's `__timestamp`, PostHog's `timestamp` and Bento's event `date`. Without it the event is stamped with the time of the call, as before. An `occurredAt` that is neither a valid `Date` nor a number of milliseconds a `Date` can hold fails validation: `invalid_options` in argument three, `invalid_properties` in a propertyless event's argument two.
