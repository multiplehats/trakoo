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
			/const provider = new EmitKitServerProvider[\s\S]*await provider\.initialize\(\);[\s\S]*createServerAnalytics/,
		);
		expect(emitkit).toMatch(/EMITKIT_API_KEY[\s\S]*server-only/i);
		expect(emitkit).toMatch(
			/dynamically imports[\s\S]*early calls[\s\S]*skipped[\s\S]*initialization completes/i,
		);
		expect(emitkit).toMatch(
			/request-scoped[\s\S]*`finally`[\s\S]*reusable[\s\S]*application or process teardown/i,
		);
	});

	it("documents Pirsch automatic SPA page views without inventing a custom event", () => {
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
	});

	it("keeps Pirsch server request-context constraints visible for browser-only setups", () => {
		const providers = read("skills/trakoo/references/providers.md");

		expect(providers).toMatch(
			/browser-only[\s\S]*server hits[\s\S]*original IP address[\s\S]*User-Agent[\s\S]*skipped/i,
		);
	});

	it("requires client readiness before the first identity transition", () => {
		const skill = read("skills/trakoo/SKILL.md");

		expect(skill).toContain("const analyticsReady = analytics.initialize();");
		expect(skill).toMatch(
			/async function identifyUser[\s\S]*await analyticsReady;[\s\S]*analytics\.identify/,
		);
		expect(skill).toMatch(
			/const restoredSession = await restoreSession\(\);[\s\S]*if \(restoredSession\.user\)[\s\S]*await identifyUser\([\s\S]*identity-sensitive events/,
		);
		expect(skill).toMatch(
			/login[\s\S]*signup[\s\S]*restored-session\/bootstrap/i,
		);
		expect(skill).toMatch(/server shutdown[\s\S]*provider[\s\S]*ownership/i);
		expect(skill).toMatch(
			/reusable[\s\S]*teardown[\s\S]*request-scoped[\s\S]*`finally`/,
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

	it("links the official Trakoo docs from source-of-truth guidance", () => {
		const skill = read("skills/trakoo/SKILL.md");

		expect(skill).toMatch(
			/source of truth[\s\S]*https:\/\/stacksee-analytics\.vercel\.app/,
		);
	});
});
