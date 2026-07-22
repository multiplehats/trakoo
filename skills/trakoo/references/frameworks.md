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

- Keep `events.ts` environment-neutral and import only root event helpers from `trakoo`.
- Import the same registry value in client and server modules:

```ts
import { appEvents } from "./events";

const analytics = createClientAnalytics({
	events: appEvents,
	providers: clientProviders,
});

const serverAnalytics = createServerAnalytics({
	events: appEvents,
	providers: serverProviders,
});
```

- Put `createClientAnalytics` and browser providers in a browser-only module.
- Put `createServerAnalytics`, server providers, and secrets in a server-only module.
- Track a business event where it becomes authoritative, not merely where navigation happens.
- Use the framework's public-variable convention only for browser-safe provider identifiers.

## Next.js

Use a client component for browser initialization, identity lifecycle, and navigation effects. Import `appEvents` and pass it as the factory's `events` option. Browser values use `NEXT_PUBLIC_*`; unprefixed values remain server-only. Put critical tracking in route handlers, server actions, or other server-only modules and pass the same registry to the server factory. Await critical events. Call `shutdown()` in the request's `finally` block only when that request created and owns a fresh provider/analytics pair. A reusable module singleton stays alive across requests and shuts down only at application or process teardown. Verify with `next build` because it catches accidental server imports in client bundles.

## SvelteKit

Initialize browser analytics only in browser-executed code such as `onMount`; import `appEvents` and pass it to the client factory. Keep server providers in `+page.server.ts`, `+server.ts`, hooks, or other server-only modules and pass the same registry to the server factory. Use `$env/static/public` or `$env/dynamic/public` for client-safe values and private `$env/*/private` modules only on the server. Use the installed SvelteKit navigation API for page views and avoid double-counting the initial navigation.

## TanStack Start

Place browser analytics in client-executed application code and server analytics inside `createServerFn` handlers or server routes. Import the shared `appEvents` registry on both sides and pass `events: appEvents` to each factory. With Vite, expose only browser-safe identifiers through `VITE_*`; keep secrets unprefixed and read them inside the per-request server handler, especially on edge runtimes. Subscribe to completed navigation for page views and clean up the subscription:

```ts
const unsubscribe = router.subscribe("onResolved", ({ toLocation }) => {
	analytics.pageView({ path: toLocation.pathname, url: toLocation.href });
});
```

Use the framework's lifecycle to call `unsubscribe()` when the owner is disposed.

## Astro

Initialize client analytics in a processed `<script>` or a hydrated UI-framework island, importing the shared registry and passing `events: appEvents`. Use `PUBLIC_*`/`astro:env/client` only for browser-safe values and `astro:env/server` for server provider secrets. Put critical tracking in endpoints, actions, middleware, or other server-rendered code and pass the same registry to the server factory. With Astro's client router, listen for completed navigations:

```ts
document.addEventListener("astro:page-load", () => {
	analytics.pageView({ path: window.location.pathname, url: window.location.href });
});
```

Ensure a persistent script or guarded setup registers the listener once so client navigation does not multiply page views.

## Framework-neutral TypeScript

Create one browser-owned instance from the application's browser entry and one server factory or request-scoped instance from server code. Import the same `appEvents` value and pass it to every factory. A short-lived request may call `shutdown()` in `finally` only for the fresh provider/analytics pair it created and owns; a reusable module singleton shuts down only at application or process teardown. Use the build tool's public environment prefix (`VITE_*` for Vite by default). Subscribe to the chosen router's completed-navigation event rather than click events, because redirects and history navigation also change pages.

## Verification

Run the framework's typecheck and production build. Confirm browser output contains no server provider import or secret name. Exercise initial load, client navigation, login, logout, and one critical server event; ensure each expected event is emitted once.
