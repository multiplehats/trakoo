---
"trakoo": minor
---

Report the full page URL from the browser adapter so campaign parameters survive. `BrowserAnalytics` built its page context from `window.location.pathname` alone, so the query string never left the browser and every `utm_source`/`utm_medium`/`utm_campaign` value was dropped before delivery — campaign traffic arrived in the dashboard as direct. The adapter now also populates the `url`, `search`, `host` and `protocol` fields that `EventContext["page"]` already declared, from a single `getPageContext()` snapshot shared by `initialize()` and `pageView()`.

This reaches any provider that reports a URL. OpenPanel, Bento, EmitKit, Pirsch and the proxy all read `context.page.url` and fall back to `context.page.path`; until now that fallback was always taken. OpenPanel's `screenView()` consequently receives the full URL, which is what its own SDK sends when it tracks screen views itself, so its `__path` changes from a bare pathname to an absolute URL and its dashboard resolves the path and domain server-side. Nothing new is collected — the query string was always present in the browser — but a site that puts sensitive values in query parameters now sends them to its analytics provider, so exclude those before they reach the URL.
