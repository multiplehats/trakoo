---
"trakoo": minor
---

Report the full page URL from the browser adapter so campaign parameters survive. `BrowserAnalytics` built its page context from `window.location.pathname` alone, so the query string never left the browser and every `utm_source`/`utm_medium`/`utm_campaign` value was dropped before delivery — campaign traffic arrived in the dashboard as direct. The adapter now also populates the `url`, `search`, `host` and `protocol` fields that `EventContext["page"]` already declared, from a single `getPageContext()` snapshot shared by `initialize()` and `pageView()`.

`updateContext()` also merges the page snapshot instead of rebuilding it from `path`, `title` and `referrer`, which had silently discarded every other declared field. Without that, only the immediate `pageView()` call carried a URL — `track()` and `pageLeave()` read the stored context and still saw none. Partial page updates now merge rather than erase, and an empty `search` is kept as a real value so a URL with no query string cannot inherit the previous page's parameters.

This reaches any provider that reports a URL. OpenPanel, Bento, EmitKit, Pirsch and the proxy all read `context.page.url` and fall back to `context.page.path`; until now that fallback was always taken. OpenPanel's `screenView()` consequently receives the full URL, which is what its own SDK sends when it tracks screen views itself, so its `__path` changes from a bare pathname to an absolute URL and its dashboard resolves the path and domain server-side. OpenPanel's `screenView()` also dedupes on the value it is handed, so two visits to one pathname under different query strings are now distinct: an app that calls `pageView()` when query parameters change — filters, pagination, tabs — emits one `screen_view` per change where it previously emitted one in total. Expect page-view counts on those routes to rise.

Nothing new is collected — the query string was always present in the browser — but a site that puts sensitive values in query parameters now sends them to its analytics provider, so exclude those before they reach the URL.
