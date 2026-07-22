# Framework Integration Reference

Read only the section matching the consuming project. Framework APIs evolve; confirm routing hooks and server boundaries against the installed framework version before editing.

## Detection

| Signal | Framework |
|---|---|
| `next.config.*` plus `next` dependency | Next.js |
| `svelte.config.*` plus `@sveltejs/kit` | SvelteKit |
| `@tanstack/react-start` and its Vite/Rsbuild plugin | TanStack Start |
| `astro.config.*` plus `astro` | Astro |
| Browser entry plus server/API entry without the above | Framework-neutral TypeScript |

## Shared rules

- Keep `events.ts` environment-neutral and import only types from `trakoo`.
- Put `createClientAnalytics` and browser providers in a browser-only module.
- Put `createServerAnalytics`, server providers, and secrets in a server-only module.
- Track a business event where it becomes authoritative, not merely where navigation happens.
- Use the framework's public-variable convention only for browser-safe provider identifiers.

## Next.js

Use a client component for browser initialization, identity lifecycle, and navigation effects. Browser values use `NEXT_PUBLIC_*`; unprefixed values remain server-only. Put critical tracking in route handlers, server actions, or other server-only modules. Await critical events and call `shutdown()` in `finally` before a short-lived request exits. Verify with `next build` because it catches accidental server imports in client bundles.

## SvelteKit

Initialize browser analytics only in browser-executed code such as `onMount`; keep server providers in `+page.server.ts`, `+server.ts`, hooks, or other server-only modules. Use `$env/static/public` or `$env/dynamic/public` for client-safe values and private `$env/*/private` modules only on the server. Use the installed SvelteKit navigation API for page views and avoid double-counting the initial navigation.

## TanStack Start

Place browser analytics in client-executed application code and server analytics inside `createServerFn` handlers or server routes. With Vite, expose only browser-safe identifiers through `VITE_*`; keep secrets unprefixed and read them inside the per-request server handler, especially on edge runtimes. Subscribe to completed navigation for page views and clean up the subscription:

```ts
const unsubscribe = router.subscribe("onResolved", ({ toLocation }) => {
	analytics.pageView({ path: toLocation.pathname, url: toLocation.href });
});
```

Use the framework's lifecycle to call `unsubscribe()` when the owner is disposed.

## Astro

Initialize client analytics in a processed `<script>` or a hydrated UI-framework island. Use `PUBLIC_*`/`astro:env/client` only for browser-safe values and `astro:env/server` for server provider secrets. Put critical tracking in endpoints, actions, middleware, or other server-rendered code. With Astro's client router, listen for completed navigations:

```ts
document.addEventListener("astro:page-load", () => {
	analytics.pageView({ path: window.location.pathname, url: window.location.href });
});
```

Ensure a persistent script or guarded setup registers the listener once so client navigation does not multiply page views.

## Framework-neutral TypeScript

Create one browser singleton from the application's browser entry and one server factory or request-scoped instance from server code. Use the build tool's public environment prefix (`VITE_*` for Vite by default). Subscribe to the chosen router's completed-navigation event rather than click events, because redirects and history navigation also change pages.

## Verification

Run the framework's typecheck and production build. Confirm browser output contains no server provider import or secret name. Exercise initial load, client navigation, login, logout, and one critical server event; ensure each expected event is emitted once.
