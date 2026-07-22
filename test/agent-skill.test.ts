import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
	readFileSync(
		fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
		"utf8",
	);

const skillFiles = [
	"skills/trakoo/SKILL.md",
	"skills/trakoo/references/events-and-validation.md",
	"skills/trakoo/references/providers.md",
	"skills/trakoo/references/frameworks.md",
];

const codeBlocks = (content: string) =>
	[...content.matchAll(/```(?:ts|tsx|typescript)\n([\s\S]*?)```/g)]
		.map((match) => match[1])
		.join("\n");

describe("Trakoo Agent Skill", () => {
	it("has discoverable metadata, v1 references, and current documentation", () => {
		const skill = read("skills/trakoo/SKILL.md");

		expect(skill).toMatch(/^---\nname: trakoo\ndescription: Use when /);
		expect(skill).toContain("https://trakoo.co");
		expect(skill).toContain("references/events-and-validation.md");
		expect(skill).toContain("references/providers.md");
		expect(skill).toContain("references/frameworks.md");
	});

	it("teaches the runtime registry and all three property modes", () => {
		const events = read("skills/trakoo/references/events-and-validation.md");

		expect(events).toContain(
			'import { defineEvents, noProperties, typed } from "trakoo"',
		);
		expect(events).toContain("export const appEvents = defineEvents({");
		expect(events).toContain("properties: typed<");
		expect(events).toContain("properties: noProperties()");
		expect(events).toMatch(
			/properties: z\.object\(\{[\s\S]*z\.coerce\.number\(\)/,
		);
	});

	it("documents direct Standard Schema validator compatibility", () => {
		const events = read("skills/trakoo/references/events-and-validation.md");

		for (const validator of ["Zod", "Valibot", "ArkType", "Standard Schema"]) {
			expect(events).toContain(validator);
		}
		expect(events).toMatch(/no Trakoo adapter/i);
		expect(events).toMatch(/install only[^\n]*chosen validator/i);
		expect(events).toMatch(/input[\s\S]*provider output[\s\S]*coerc/i);
	});

	it("binds both factories to the shared registry without event generics", () => {
		const skill = read("skills/trakoo/SKILL.md");
		const registry = skill.match(
			/## Shared event registry[\s\S]*?```ts\n([\s\S]*?)```/,
		)?.[1];
		const browser = skill.match(
			/## Browser module\n\n```ts\n([\s\S]*?)```/,
		)?.[1];
		const server = skill.match(
			/## Server module and critical event\n\n```ts\n([\s\S]*?)```/,
		)?.[1];

		expect(registry).toContain("purchaseCompleted");
		expect(registry).toContain('name: "purchase_completed"');
		expect(browser).toMatch(/import \{ appEvents \} from "\.\/events"/);
		expect(browser).toMatch(/createClientAnalytics\(\{\s*events: appEvents,/);
		expect(browser).not.toMatch(/createClientAnalytics</);
		expect(browser).toContain("userTraits: typed<BrowserUserTraits>()");
		expect(server).toMatch(/import \{ appEvents \} from "\.\/events"/);
		expect(server).toMatch(/createServerAnalytics\(\{\s*events: appEvents,/);
		expect(server).not.toMatch(/createServerAnalytics</);
	});

	it("documents propertyless client and server call shapes", () => {
		const events = read("skills/trakoo/references/events-and-validation.md");

		expect(events).toContain('analytics.track("session_started")');
		expect(events).toMatch(
			/serverAnalytics\.track\(\s*"session_started",\s*\{\s*userId: "user_123",/,
		);
		expect(events).toMatch(/server options go directly in argument two/i);
		expect(events).toMatch(/never pass an `undefined` properties placeholder/i);
	});

	it("documents asynchronous validation and delivery ordering", () => {
		const events = read("skills/trakoo/references/events-and-validation.md");

		expect(events).toContain("`Promise<void>`");
		expect(events).toMatch(/validation finishes before provider routing/i);
		expect(events).toMatch(/concurrent[\s\S]*not guaranteed[\s\S]*call order/i);
	});

	it("documents validation defaults and sanitized reporting", () => {
		const events = read("skills/trakoo/references/events-and-validation.md");
		const failureExample = events.match(
			/## Failure policy and security[\s\S]*?```ts\n([\s\S]*?)```/,
		)?.[1];

		expect(events).toContain('onFailure: "throw"');
		expect(events).toContain("AnalyticsValidationError");
		expect(events).toMatch(/defaults? to `?"drop"`?[^\n]*client and server/i);
		expect(events).toMatch(/`onError`[\s\S]*exactly once/i);
		expect(events).toMatch(
			/AnalyticsValidationError[\s\S]*never retains[\s\S]*submitted properties object[\s\S]*validator exception/i,
		);
		expect(events).toMatch(
			/normalized issues[\s\S]*may include[\s\S]*validator-provided messages/i,
		);
		expect(events).toMatch(
			/default debug logging[\s\S]*never[\s\S]*raw messages[\s\S]*input/i,
		);
		expect(events).toMatch(
			/select[\s\S]*sanitize[\s\S]*fields[\s\S]*observability/i,
		);
		expect(events).toMatch(
			/does not redefine[\s\S]*provider-delivery[\s\S]*initialization/i,
		);
		expect(failureExample).toContain("onError(error)");
		expect(failureExample).toContain("code: error.code");
		expect(failureExample).toContain("eventName: error.eventName");
		expect(failureExample).toContain("paths:");
		expect(failureExample).not.toContain("reportValidationFailure(error)");
		expect(failureExample).not.toContain("error: AnalyticsValidationError");
	});

	it("keeps event helpers neutral and runtime-specific APIs on subpaths", () => {
		const skill = read("skills/trakoo/SKILL.md");

		expect(skill).toContain("environment-neutral");
		expect(skill).toContain("trakoo/client");
		expect(skill).toContain("trakoo/server");
		expect(skill).toContain("trakoo/providers/client");
		expect(skill).toContain("trakoo/providers/server");
		expect(skill).toMatch(/fresh[\s\S]*registry-bound instance/i);
	});

	it("contains no legacy event or singleton API guidance", () => {
		const content = skillFiles.map(read).join("\n");
		const code = codeBlocks(content);
		const forbidden = [
			"CreateEventDefinition",
			"EventCollection",
			"as const satisfies",
			"properties: {} as",
			"AppEvents",
			"createClientAnalytics<",
			"createServerAnalytics<",
			"typeof appEvents",
			"createAnalytics",
			"getAnalytics",
			"resetAnalyticsInstance",
		];

		for (const pattern of forbidden) {
			expect(content).not.toContain(pattern);
		}

		for (const helper of [
			"track",
			"identify",
			"pageView",
			"pageLeave",
			"reset",
			"flush",
		]) {
			expect(code).not.toMatch(
				new RegExp(
					`import\\s*\\{[^}]*\\b${helper}\\b[^}]*\\}\\s*from\\s*["']trakoo/client["']`,
				),
			);
			expect(code).not.toMatch(new RegExp(`(^|[^\\w.])${helper}\\s*\\(`, "m"));
		}
	});

	it("covers every public provider and its delivery constraints", () => {
		const providers = read("skills/trakoo/references/providers.md");

		for (const name of [
			"PostHog",
			"OpenPanel",
			"Bento",
			"Pirsch",
			"EmitKit",
			"Visitors",
			"Proxy",
			"BaseAnalyticsProvider",
		]) {
			expect(providers).toContain(name);
		}
		expect(providers).toContain("@bentonow/bento-node-sdk");
		expect(providers).toContain("IP address and User-Agent");
		expect(providers).toContain("excludeEvents");
		expect(providers).toContain("eventPatterns");
	});

	it("documents usable Pirsch and Bento constructor contracts", () => {
		const providers = read("skills/trakoo/references/providers.md");

		expect(providers).toContain(
			"PirschClientProvider({ identificationCode, hostname? })",
		);
		expect(providers).toMatch(
			/new PirschClientProvider\(\{\s*identificationCode: import\.meta\.env\.VITE_PIRSCH_IDENTIFICATION_CODE,\s*\}\)/,
		);
		expect(providers).toContain(
			"BentoServerProvider({ siteUuid, authentication: { publishableKey, secretKey } })",
		);
		expect(providers).toMatch(
			/new BentoServerProvider\(\{\s*siteUuid: process\.env\.BENTO_SITE_UUID!,\s*authentication: \{\s*publishableKey: process\.env\.BENTO_PUBLISHABLE_KEY!,\s*secretKey: process\.env\.BENTO_SECRET_KEY!,\s*\},\s*\}\)/,
		);
		expect(providers).toMatch(
			/VITE_PIRSCH_IDENTIFICATION_CODE[\s\S]*browser-public/,
		);
		expect(providers).toMatch(/BENTO_SECRET_KEY[\s\S]*server-only/);
	});

	it("documents Bento initialization and shutdown ownership", () => {
		const providers = read("skills/trakoo/references/providers.md");
		const bento = providers.match(
			/### Bento\n\n([\s\S]*?)\n\n### EmitKit/,
		)?.[1];

		expect(bento).toMatch(
			/const provider = new BentoServerProvider[\s\S]*await provider\.initialize\(\);[\s\S]*createServerAnalytics\(\{[\s\S]*events: appEvents/,
		);
		expect(providers).toContain(
			"Do not call `shutdown()` after each event on a reusable module singleton.",
		);
		expect(bento).toMatch(
			/request-scoped[\s\S]*fresh provider and analytics pair[\s\S]*same pair[\s\S]*`finally`/,
		);
		expect(bento).toMatch(/long-lived[\s\S]*application or process teardown/);
		expect(bento).toContain(
			"Bento `shutdown()` clears provider state; it is not a buffered flush.",
		);
	});

	it("documents awaited EmitKit initialization and its server-only key boundary", () => {
		const providers = read("skills/trakoo/references/providers.md");
		const emitkit = providers.match(
			/### EmitKit\n\n([\s\S]*?)(?:\n\n### |\n\n## )/,
		)?.[1];

		expect(emitkit).toBeDefined();
		expect(emitkit).toMatch(
			/import \{ EmitKitServerProvider \} from "trakoo\/providers\/server"/,
		);
		expect(emitkit).toMatch(
			/new EmitKitServerProvider\(\{\s*apiKey: process\.env\.EMITKIT_API_KEY!,\s*\}\)/,
		);
		expect(emitkit).toMatch(
			/const provider = new EmitKitServerProvider[\s\S]*await provider\.initialize\(\);[\s\S]*createServerAnalytics\(\{[\s\S]*events: appEvents/,
		);
		expect(emitkit).toMatch(/EMITKIT_API_KEY[\s\S]*server-only/i);
		expect(emitkit).toMatch(
			/dynamically imports[\s\S]*early calls[\s\S]*skipped[\s\S]*initialization completes/i,
		);
		expect(emitkit).toMatch(
			/request-scoped[\s\S]*`finally`[\s\S]*reusable[\s\S]*application or process teardown/i,
		);
	});

	it("preserves Pirsch navigation and request-context constraints", () => {
		const providers = read("skills/trakoo/references/providers.md");

		expect(providers).toMatch(
			/pa\.js[\s\S]*initial page load[\s\S]*History API URL changes[\s\S]*by default/,
		);
		expect(providers).toContain(
			"`window.pirsch(name, options)` is the custom-event API",
		);
		expect(providers).toContain("Do not redeclare `Window.pirsch`");
		expect(providers).not.toMatch(
			/window\.pirsch(?:\?\.)?\(\s*["']pageview["']/i,
		);
		expect(providers).toMatch(
			/verify one initial hit[\s\S]*one SPA navigation hit/i,
		);
		expect(providers).toContain(
			'`methods: ["pageView"]` does not emit SPA navigation hits.',
		);
		expect(providers).toMatch(
			/router does not produce observable History API changes[\s\S]*page-view API explicitly supported by the installed Pirsch version/,
		);
		expect(providers).toMatch(
			/browser-only[\s\S]*server hits[\s\S]*original IP address[\s\S]*User-Agent[\s\S]*skipped/i,
		);
	});

	it("documents accurate Bento and Visitors identity constraints", () => {
		const providers = read("skills/trakoo/references/providers.md");
		const bento = providers.match(
			/### Bento\n\n([\s\S]*?)\n\n### EmitKit/,
		)?.[1];
		const visitors = providers.match(
			/### Visitors\n\n([\s\S]*?)\n\n### Proxy/,
		)?.[1];

		expect(bento).toMatch(/anonymous page views[\s\S]*browser/i);
		expect(bento).toMatch(
			/email[\s\S]*identif(?:y|ication)[\s\S]*identified lifecycle[\s\S]*server events/i,
		);
		expect(bento).not.toMatch(/email before sending Bento events/i);
		expect(visitors).toMatch(
			/`identify\(\)`[\s\S]*does not require persistence/i,
		);
		expect(visitors).toMatch(
			/persistence[\s\S]*cross-session tracking[\s\S]*revenue attribution/i,
		);
		expect(visitors).toMatch(/consent/i);
	});

	it("treats proxy ingestion as an untrusted application endpoint", () => {
		const providers = read("skills/trakoo/references/providers.md");
		const proxy = providers.match(
			/### Proxy\n\n([\s\S]*?)\n\n## Custom providers/,
		)?.[1];

		expect(proxy).toMatch(/untrusted JSON/i);
		expect(proxy).toMatch(
			/same-origin `Origin`[\s\S]*CORS[\s\S]*authenticated session/i,
		);
		expect(proxy).toMatch(/request body[\s\S]*batch-size limits/i);
		expect(proxy).toMatch(/rate limit/i);
		expect(proxy).toMatch(/trusted prox(?:y|ies)[\s\S]*forwarded IP headers/i);
		expect(proxy).toMatch(
			/client-proxied[\s\S]*`userId`[\s\S]*traits[\s\S]*events[\s\S]*authoritative/i,
		);
		expect(proxy).toMatch(
			/runtime registry validation[\s\S]*(?:necessary|required)[\s\S]*not sufficient/i,
		);
	});

	it("requires client readiness before the first identity transition", () => {
		const skill = read("skills/trakoo/SKILL.md");

		expect(skill).toContain("const analyticsReady = analytics.initialize();");
		expect(skill).toMatch(
			/async function identifyUser[\s\S]*await analyticsReady;[\s\S]*analytics\.identify/,
		);
		expect(skill).toMatch(
			/login[\s\S]*signup[\s\S]*restored-session\/bootstrap/i,
		);
	});

	it("uses distinct browser and server trait contracts", () => {
		const skill = read("skills/trakoo/SKILL.md");
		const events = read("skills/trakoo/references/events-and-validation.md");
		const browser = skill.match(
			/## Browser module\n\n```ts\n([\s\S]*?)```/,
		)?.[1];
		const server = skill.match(
			/## Server module and critical event\n\n```ts\n([\s\S]*?)```/,
		)?.[1];

		expect(browser).toMatch(
			/interface BrowserUserTraits \{\s*email: string;\s*plan: "free" \| "pro";\s*\}/,
		);
		expect(browser).toContain("userTraits: typed<BrowserUserTraits>()");
		expect(browser).toMatch(
			/identifyUser\(userId: string, traits: BrowserUserTraits\)/,
		);
		expect(skill).toMatch(
			/await identifyUser\([\s\S]*email: restoredSession\.user\.email,[\s\S]*plan: restoredSession\.user\.plan,/,
		);
		expect(server).toMatch(
			/interface ServerUserTraits \{\s*plan: "free" \| "pro";\s*\}/,
		);
		expect(server).toContain("userTraits: typed<ServerUserTraits>()");
		expect(server).not.toMatch(/interface ServerUserTraits \{[^}]*email:/);
		expect(events).toMatch(
			/interface BrowserUserTraits \{[\s\S]*email: string;[\s\S]*plan: "free" \| "pro";[\s\S]*\}[\s\S]*interface ServerUserTraits \{[\s\S]*plan: "free" \| "pro";[\s\S]*\}/,
		);
		expect(events).toMatch(
			/browser marker[\s\S]*every object-literal field[\s\S]*`identify\(\)`/i,
		);
	});

	it("keeps critical server analytics owned by the request invocation", () => {
		const skill = read("skills/trakoo/SKILL.md");
		const serverExample = skill.match(
			/## Server module and critical event[\s\S]*?```ts\n([\s\S]*?)```/,
		)?.[1];

		expect(serverExample).toBeDefined();
		expect(serverExample).toMatch(
			/export async function [^(]+\([^)]*\) \{\s*const analytics = createRequestAnalytics\(\);\s*try \{/,
		);
		expect(serverExample).not.toMatch(
			/^const analytics = createRequestAnalytics\(\);/m,
		);
		expect(serverExample).toMatch(
			/userId: input\.userId,\s*user: \{\s*email: input\.email,\s*traits: \{ plan: input\.plan \},\s*\}/,
		);
		expect(serverExample).not.toMatch(/user:\s*input\.user/);
		expect(serverExample).not.toMatch(/user:\s*\{\s*email:[^}]*,\s*plan:/);
	});

	it("nests custom traits in propertyless server user context", () => {
		const events = read("skills/trakoo/references/events-and-validation.md");
		const propertyless = events.match(
			/## Propertyless calls[\s\S]*?```ts\n([\s\S]*?)```[\s\S]*?```ts\n([\s\S]*?)```/,
		)?.[2];

		expect(events).toMatch(
			/identity fields[\s\S]*top-level[\s\S]*`user`[\s\S]*application traits[\s\S]*`user\.traits`/i,
		);
		expect(propertyless).toMatch(
			/userId: "user_123",\s*user: \{\s*email: "ada@example\.com",\s*traits: \{ plan: "pro" \},\s*\}/,
		);
		expect(events).not.toMatch(/user:\s*input\.user/);
	});

	it("documents PostHog capture credentials and page-view ownership", () => {
		const providers = read("skills/trakoo/references/providers.md");
		const posthog = providers.match(
			/### PostHog\n\n([\s\S]*?)\n\n### Bento/,
		)?.[1];

		expect(posthog).toBeDefined();
		expect(posthog).toMatch(/project (?:capture |API )?key[\s\S]*`phc_/i);
		expect(posthog).toMatch(/`phx_`[\s\S]*personal API key[\s\S]*never/i);
		expect(posthog).toMatch(
			/new PostHogClientProvider\(\{\s*token: import\.meta\.env\.VITE_POSTHOG_PROJECT_KEY,/,
		);
		expect(posthog).toMatch(
			/new PostHogServerProvider\(\{\s*apiKey: process\.env\.POSTHOG_PROJECT_KEY!,/,
		);
		expect(posthog).toContain("capture_pageview: false");
		expect(posthog).toMatch(/one page-view owner/i);
		expect(posthog).toMatch(/page-leave[\s\S]*one[- ]owner/i);
		expect(posthog).toMatch(/normalize[\s\S]*URL[\s\S]*deduplic/i);
	});

	it("passes the registry through supported framework boundaries", () => {
		const frameworks = read("skills/trakoo/references/frameworks.md");

		for (const name of [
			"Next.js",
			"SvelteKit",
			"TanStack Start",
			"Astro",
			"Framework-neutral",
		]) {
			expect(frameworks).toContain(name);
		}
		expect(frameworks).toContain('import { appEvents } from "./events"');
		expect(frameworks).toMatch(/events: appEvents/g);
		expect(frameworks).toContain('router.subscribe("onResolved"');
		expect(frameworks).toContain("astro:page-load");
		expect(frameworks).toContain("PUBLIC_");
		expect(frameworks).toContain("VITE_");
	});

	it("ties request shutdown to fresh instance ownership in framework guidance", () => {
		const frameworks = read("skills/trakoo/references/frameworks.md");
		const nextjs = frameworks.match(
			/## Next\.js\n\n([\s\S]*?)\n\n## SvelteKit/,
		)?.[1];
		const neutral = frameworks.match(
			/## Framework-neutral TypeScript\n\n([\s\S]*?)\n\n## Verification/,
		)?.[1];

		for (const guidance of [nextjs, neutral]) {
			expect(guidance).toMatch(/fresh provider\/analytics pair/);
			expect(guidance).toMatch(
				/reusable module singleton[\s\S]*application or process teardown/,
			);
		}
	});

	it("enforces TanStack Start runtime boundaries and page-view ownership", () => {
		const frameworks = read("skills/trakoo/references/frameworks.md");
		const tanstack = frameworks.match(
			/## TanStack Start\n\n([\s\S]*?)\n\n## Astro/,
		)?.[1];

		expect(tanstack).toContain("analytics.client.ts");
		expect(tanstack).toContain("analytics.server.ts");
		expect(tanstack).toContain('import "@tanstack/react-start/client-only"');
		expect(tanstack).toContain('import "@tanstack/react-start/server-only"');
		expect(tanstack).toMatch(
			/\.server\.ts[\s\S]*imported only inside[\s\S]*server-function[\s\S]*handler/i,
		);
		expect(tanstack).toContain(
			'import { createServerFn } from "@tanstack/react-start"',
		);
		expect(tanstack).toContain("createServerFn");
		expect(tanstack).toContain(".handler(async");
		expect(tanstack).toContain('await import("./analytics.server")');
		expect(tanstack).toMatch(
			/unprefixed[\s\S]*environment[\s\S]*`.handler\(\)`[\s\S]*per-request/i,
		);
		expect(tanstack).toMatch(/edge[\s\S]*bindings/i);
		expect(tanstack).toContain("capture_pageview: false");
		expect(tanstack).toMatch(/one page-view owner/i);
		expect(tanstack).toContain("new URL(href, window.location.origin)");
		expect(tanstack).toContain('router.subscribe("onResolved"');
		expect(tanstack).toContain("unsubscribe()");
	});

	it("mounts TanStack page tracking through an isomorphic root integration", () => {
		const frameworks = read("skills/trakoo/references/frameworks.md");
		const tanstack = frameworks.match(
			/## TanStack Start\n\n([\s\S]*?)\n\n## Astro/,
		)?.[1];
		const code = codeBlocks(tanstack ?? "");

		expect(tanstack).toContain("PageViewTracker.tsx");
		expect(tanstack).not.toContain("PageViewTracker.client.tsx");
		expect(tanstack).toContain(
			'import { createClientOnlyFn } from "@tanstack/react-start"',
		);
		expect(code).toMatch(
			/createClientOnlyFn\(\(router:[\s\S]*await import\("\.\/analytics\.client"\)/,
		);
		expect(code).toMatch(
			/function PageViewTracker\(\)[\s\S]*useEffect\(\(\) => startPageViews\(router\), \[router\]\)[\s\S]*return null/,
		);
		expect(tanstack).toMatch(
			/isomorphic[\s\S]*root route[\s\S]*must not[\s\S]*`\*\.client\.tsx`/i,
		);
		expect(tanstack).toMatch(
			/import \{ PageViewTracker \} from "\.\/PageViewTracker"[\s\S]*function RootComponent\(\)[\s\S]*<PageViewTracker \/>/,
		);
		expect(tanstack).toMatch(
			/confirm[\s\S]*installed[\s\S]*`createClientOnlyFn`[\s\S]*production build/i,
		);
	});

	it("awaits browser readiness before TanStack and Astro page views", () => {
		const frameworks = read("skills/trakoo/references/frameworks.md");
		const tanstack = frameworks.match(
			/## TanStack Start\n\n([\s\S]*?)\n\n## Astro/,
		)?.[1];
		const astro = frameworks.match(
			/## Astro\n\n([\s\S]*?)\n\n## Framework-neutral TypeScript/,
		)?.[1];
		const tanstackCode = codeBlocks(tanstack ?? "");
		const astroCode = codeBlocks(astro ?? "");

		expect(tanstack).toMatch(/retained[\s\S]*initialization promise/i);
		expect(tanstackCode).toMatch(
			/await analyticsReady;[\s\S]*emitPageView\(window\.location\.href\)[\s\S]*router\.subscribe/,
		);
		expect(tanstackCode).not.toMatch(
			/emitPageView\(window\.location\.href\)[\s\S]*await analyticsReady/,
		);
		expect(astro).toMatch(/retained[\s\S]*initialization promise/i);
		expect(astroCode).toMatch(
			/astro:page-load[\s\S]*await analyticsReady;[\s\S]*analytics\.pageView/,
		);
		expect(tanstack).toMatch(/disposed[\s\S]*unsubscribe/i);
		expect(astro).toMatch(/registers the listener once/i);
	});

	it("keeps TanStack critical events authoritative on the server", () => {
		const frameworks = read("skills/trakoo/references/frameworks.md");
		const tanstack = frameworks.match(
			/## TanStack Start\n\n([\s\S]*?)\n\n## Astro/,
		)?.[1];
		const code = codeBlocks(tanstack ?? "");
		const inputSchema = code.match(
			/const trackPurchaseInput = z\.object\(\{([\s\S]*?)\}\);/,
		)?.[1];

		expect(inputSchema).toMatch(/^\s*orderId: z\.string\(\)\.min\(1\),?\s*$/);
		expect(code).toContain(".validator(trackPurchaseInput)");
		expect(code).toContain("const user = await requireUser()");
		expect(code).toMatch(
			/purchases\.confirmAndLoad\(\{\s*orderId: data\.orderId,\s*userId: user\.id,\s*\}\)/,
		);
		expect(code).toMatch(
			/await analytics\.track\(\s*"purchase_completed",\s*\{\s*orderId: order\.id,\s*amount: order\.totalAmount,\s*currency: order\.currency,\s*\},\s*\{\s*userId: user\.id,\s*user: \{\s*email: user\.email,\s*traits: \{ plan: order\.plan \},\s*\},\s*\},\s*\)/,
		);
		expect(code).not.toMatch(/data\.(?:properties|options)\b/);
		expect(code).not.toMatch(/\bdata\s+as\s+/);
		expect(code).not.toMatch(/(?:amount|currency|userId|email|plan):\s*data\./);
		expect(tanstack).toMatch(
			/`requireUser` and `purchases\.confirmAndLoad`[\s\S]*consuming application/i,
		);
	});

	it("documents skills CLI installation", () => {
		const readme = read("readme.md");

		expect(readme).toContain("## Agent Skill");
		expect(readme).toContain(
			"npx skills add multiplehats/trakoo --skill trakoo",
		);
		expect(readme).toContain("skills/trakoo/SKILL.md");
	});

	it("gates publication on real-package v1 consumer fixtures", () => {
		const skill = read("skills/trakoo/SKILL.md");
		const verification = skill.match(
			/## Verification\n\n([\s\S]*?)\n\n## Common mistakes/,
		)?.[1];

		expect(verification).toBeDefined();
		expect(verification).toMatch(/maintainer release gate/i);
		expect(verification).toMatch(
			/must not be published[\s\S]*PR #32[\s\S]*migrated implementation lands/i,
		);
		expect(verification).toMatch(
			/representative consumer fixtures[\s\S]*compiled[\s\S]*typechecked[\s\S]*real built package/i,
		);
		expect(verification).toMatch(/not[\s\S]*fabricated declarations/i);
		for (const requiredCoverage of [
			"root helpers and registry",
			"Zod transformation and distinct input/output types",
			"Valibot or ArkType",
			"client and server factories sharing `events`",
			"browser identify traits and nested server traits",
			"propertyless client call",
			"propertyless server-options call",
			'validation `"drop"` and `"throw"`',
		]) {
			expect(verification).toContain(requiredCoverage);
		}
	});
});
