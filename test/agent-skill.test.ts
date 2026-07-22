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

		expect(registry).toContain("purchaseCompleted");
		expect(registry).toContain('name: "purchase_completed"');
		expect(skill).toContain('import { appEvents } from "./events"');
		expect(skill).toMatch(/createClientAnalytics\(\{[\s\S]*events: appEvents/);
		expect(skill).toMatch(/createServerAnalytics\(\{[\s\S]*events: appEvents/);
		expect(skill).toContain("userTraits: typed<UserTraits>()");
	});

	it("documents propertyless client and server call shapes", () => {
		const events = read("skills/trakoo/references/events-and-validation.md");

		expect(events).toContain('analytics.track("session_started")');
		expect(events).toMatch(
			/serverAnalytics\.track\(\s*"session_started",\s*\{ userId: "user_123" \},\s*\)/,
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

		expect(events).toContain('onFailure: "throw"');
		expect(events).toContain("AnalyticsValidationError");
		expect(events).toMatch(/defaults? to `?"drop"`?[^\n]*client and server/i);
		expect(events).toMatch(/`onError`[\s\S]*exactly once/i);
		expect(events).toMatch(
			/sanitized[\s\S]*do not retain or expose[\s\S]*payload/i,
		);
		expect(events).toMatch(
			/does not redefine[\s\S]*provider-delivery[\s\S]*initialization/i,
		);
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
		const forbidden = [
			"CreateEventDefinition",
			"EventCollection",
			"as const satisfies",
			"properties: {} as",
			"AppEvents",
			"createClientAnalytics<",
			"createServerAnalytics<",
			"typeof appEvents",
			"getAnalytics",
			"resetAnalyticsInstance",
		];

		for (const pattern of forbidden) {
			expect(content).not.toContain(pattern);
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

	it("passes the registry to provider examples and preserves initialization", () => {
		const providers = read("skills/trakoo/references/providers.md");

		expect(providers).toMatch(
			/const provider = new BentoServerProvider[\s\S]*await provider\.initialize\(\);[\s\S]*createServerAnalytics\(\{[\s\S]*events: appEvents/,
		);
		expect(providers).toMatch(
			/const provider = new EmitKitServerProvider[\s\S]*await provider\.initialize\(\);[\s\S]*createServerAnalytics\(\{[\s\S]*events: appEvents/,
		);
		expect(providers).toContain(
			"Do not call `shutdown()` after each event on a reusable module singleton.",
		);
		expect(providers).toMatch(/request-scoped[\s\S]*`finally`/);
	});

	it("preserves Pirsch navigation and request-context constraints", () => {
		const providers = read("skills/trakoo/references/providers.md");

		expect(providers).toMatch(
			/pa\.js[\s\S]*initial page load[\s\S]*History API URL changes[\s\S]*by default/,
		);
		expect(providers).toContain(
			"`window.pirsch(name, options)` is the custom-event API",
		);
		expect(providers).not.toMatch(
			/window\.pirsch(?:\?\.)?\(\s*["']pageview["']/i,
		);
		expect(providers).toMatch(
			/server hits[\s\S]*original IP address[\s\S]*User-Agent[\s\S]*skipped/i,
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

	it("documents skills CLI installation", () => {
		const readme = read("readme.md");

		expect(readme).toContain("## Agent Skill");
		expect(readme).toContain(
			"npx skills add multiplehats/trakoo --skill trakoo",
		);
		expect(readme).toContain("skills/trakoo/SKILL.md");
	});
});
