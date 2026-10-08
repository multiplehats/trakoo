# @trakoo/posthog

## 1.1.0

### Minor Changes

- Server analytics records revenue with `revenue(amount, properties?, { currency, id, userId, user, groups, occurredAt, context })`. The amount is in the currency's minor unit, as a non-negative safe integer. The options are optional: `currency` is three upper-case letters, `id` names the payment for providers that deduplicate by it, and `user` carries the payer's email as in `track()`. An invalid amount or option fails validation with `invalid_options`; properties that are not a plain object, or that include `currency`, fail with `invalid_properties`. Providers opt in by implementing the new optional `revenue` method; routing calls it `"revenue"`, and event filters do not apply to it. As in `track()`, a provider that fails is logged and the others still deliver. ([#57](https://github.com/multiplehats/trakoo/pull/57))

  - `@trakoo/openpanel`'s server provider sends OpenPanel's `revenue` event, with the amount as `__revenue`, the user as its profile, its groups per event, and `currency` as a property. A `deviceId` property links the revenue to the visitor's device.
  - `@trakoo/posthog`'s server provider captures a `revenue` event with `revenue`, `currency` and `revenue_id` properties and the groups as PostHog's `groups`, for PostHog's revenue analytics.
  - `@trakoo/bento`'s server provider tracks a `$purchase`, deduplicated by `id`, toward the subscriber's lifetime value; it skips revenue without an email, a currency or an `id`.

  `group()` now calls every provider even when one throws before returning a promise, then rethrows the first failure, as it already did for a rejected one.

## 1.0.0

### Major Changes

- First release of the PostHog providers as their own package, moved out of trakoo core. Import `PostHogClientProvider` from `@trakoo/posthog/client` and `PostHogServerProvider` from `@trakoo/posthog/server`. ([#43](https://github.com/multiplehats/trakoo/pull/43))

  Changes from the trakoo 1.x providers:

  - Server events without a user no longer share one `"anonymous"` person. Each gets its own distinct ID and `$process_person_profile: false`, as PostHog recommends, so anonymous traffic stops accumulating on a single person and unique-user counts change.
  - Server events forward the visitor's IP and user agent (`context.server`, falling back to `context.device`) as `$ip` and `$raw_user_agent`, the page as `$current_url` (`page.url`, falling back to `page.path`), and the campaign as `utm_source`, `utm_medium` and `utm_campaign`. GeoIP runs on events that carry a visitor IP unless `disableGeoip` is set. The IP is no longer stored inside the `device` property.
  - Server events carry trakoo's event time as the PostHog event timestamp instead of a `timestamp` property.
  - The server provider's default host is PostHog's US ingestion host, `https://us.i.posthog.com`, instead of the legacy `https://app.posthog.com`. EU projects still set `host`.
  - Browser events keep posthog-js's own full, current `$current_url` instead of replacing it with the path from the last `pageView()`.

### Patch Changes

- Updated dependencies [[`019013c`](https://github.com/multiplehats/trakoo/commit/019013c2f69cf7b10c21462f579c41b50e7a6223), [`019013c`](https://github.com/multiplehats/trakoo/commit/019013c2f69cf7b10c21462f579c41b50e7a6223)]:
  - trakoo@2.0.0
