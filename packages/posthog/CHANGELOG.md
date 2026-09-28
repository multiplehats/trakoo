# @trakoo/posthog

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
