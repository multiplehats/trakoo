import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
	readFileSync(
		fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
		"utf8",
	);

describe("Trakoo Agent Skill", () => {
	it("has discoverable metadata and core integration rules", () => {
		const skill = read("skills/trakoo/SKILL.md");

		expect(skill).toMatch(/^---\nname: trakoo\ndescription: Use when /);
		expect(skill).toContain("trakoo/client");
		expect(skill).toContain("trakoo/server");
		expect(skill).toContain("trakoo/providers/client");
		expect(skill).toContain("trakoo/providers/server");
		expect(skill).toContain("as const satisfies");
		expect(skill).toContain("createClientAnalytics<AppEvents>");
		expect(skill).toContain("createServerAnalytics<AppEvents>");
		expect(skill).toContain("shutdown()");
		expect(skill).toContain("references/providers.md");
		expect(skill).toContain("references/frameworks.md");
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
		expect(providers).toContain("methods");
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

		expect(providers).toMatch(
			/const provider = new BentoServerProvider[\s\S]*await provider\.initialize\(\);[\s\S]*createServerAnalytics/,
		);
		expect(providers).toContain(
			"Do not call `shutdown()` after each event on a reusable module singleton.",
		);
		expect(providers).toMatch(
			/request-scoped[\s\S]*fresh provider and analytics pair[\s\S]*same pair[\s\S]*`finally`/,
		);
		expect(providers).toMatch(
			/long-lived[\s\S]*application or process teardown/,
		);
		expect(providers).toContain(
			"Bento `shutdown()` clears provider state; it is not a buffered flush.",
		);
	});

	it("documents the Pirsch initial-load and SPA navigation limitation", () => {
		const providers = read("skills/trakoo/references/providers.md");

		expect(providers).toMatch(
			/pa\.js[\s\S]*initial page load[\s\S]*`pageView\(\)` is a no-op/,
		);
		expect(providers).toContain(
			'`methods: ["pageView"]` does not emit SPA navigation hits.',
		);
		expect(providers).toMatch(
			/installed Pirsch provider and version[\s\S]*supported SPA delivery path/,
		);
	});

	it("requires client readiness before the first identity transition", () => {
		const skill = read("skills/trakoo/SKILL.md");

		expect(skill).toContain("const analyticsReady = analytics.initialize();");
		expect(skill).toMatch(
			/async function identifyUser[\s\S]*await analyticsReady;[\s\S]*analytics\.identify/,
		);
		expect(skill).toMatch(/server shutdown[\s\S]*provider[\s\S]*ownership/i);
		expect(skill).toMatch(
			/reusable[\s\S]*teardown[\s\S]*request-scoped[\s\S]*`finally`/,
		);
	});

	it("covers supported framework boundaries", () => {
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
