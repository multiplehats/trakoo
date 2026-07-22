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
});
