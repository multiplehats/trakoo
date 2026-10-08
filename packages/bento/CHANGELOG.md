# @trakoo/bento

## 1.1.0

### Minor Changes

- Server analytics records revenue with `revenue(amount, properties?, { currency, id, userId, user, groups, occurredAt, context })`. The amount is in the currency's minor unit, as a non-negative safe integer. The options are optional: `currency` is three upper-case letters, `id` names the payment for providers that deduplicate by it, and `user` carries the payer's email as in `track()`. An invalid amount or option fails validation with `invalid_options`; properties that are not a plain object, or that include `currency`, fail with `invalid_properties`. Providers opt in by implementing the new optional `revenue` method; routing calls it `"revenue"`, and event filters do not apply to it. As in `track()`, a provider that fails is logged and the others still deliver. ([#57](https://github.com/multiplehats/trakoo/pull/57))

  - `@trakoo/openpanel`'s server provider sends OpenPanel's `revenue` event, with the amount as `__revenue`, the user as its profile, its groups per event, and `currency` as a property. A `deviceId` property links the revenue to the visitor's device.
  - `@trakoo/posthog`'s server provider captures a `revenue` event with `revenue`, `currency` and `revenue_id` properties and the groups as PostHog's `groups`, for PostHog's revenue analytics.
  - `@trakoo/bento`'s server provider tracks a `$purchase`, deduplicated by `id`, toward the subscriber's lifetime value; it skips revenue without an email, a currency or an `id`.

  `group()` now calls every provider even when one throws before returning a promise, then rethrows the first failure, as it already did for a rejected one.

## 1.0.0

### Major Changes

- First release of the Bento server provider as its own package, moved out of trakoo core. Import `BentoServerProvider` from `@trakoo/bento/server`; Bento's browser provider stays in `trakoo/providers/client`. Supports `@bentonow/bento-node-sdk` 0.2 and 2.x. ([#43](https://github.com/multiplehats/trakoo/pull/43))

  Changes from the trakoo 1.x provider:

  - `identify()` updates the subscriber's fields with `$update_fields` instead of sending `$subscribe`, which subscribed the person to marketing email and re-ran subscribe automations on every call. Call Bento's `V1.addSubscriber()` directly to subscribe someone.
  - `track()` sends the event time as Bento's event `date`.
  - An event that Bento accepts without queueing is logged as a failure instead of as tracked.

### Patch Changes

- Updated dependencies [[`019013c`](https://github.com/multiplehats/trakoo/commit/019013c2f69cf7b10c21462f579c41b50e7a6223), [`019013c`](https://github.com/multiplehats/trakoo/commit/019013c2f69cf7b10c21462f579c41b50e7a6223)]:
  - trakoo@2.0.0
