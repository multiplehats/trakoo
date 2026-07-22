import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("public event type diagnostics", () => {
	it("reports concise public names for invalid event usage", () => {
		const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
		const fixture = resolve(
			root,
			"test/fixtures/invalid-event-usage.ts",
		);
		const configDirectory = mkdtempSync(
			join(tmpdir(), "trakoo-type-diagnostics-"),
		);
		const configPath = join(configDirectory, "tsconfig.json");
		const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
		const result = (() => {
			try {
				writeFileSync(
					configPath,
					JSON.stringify({
						extends: resolve(root, "tsconfig.json"),
						compilerOptions: {
							strict: true,
							noEmit: true,
							types: ["node"],
							typeRoots: [resolve(root, "node_modules/@types")],
							target: "ES2022",
							module: "ESNext",
							moduleResolution: "Bundler",
						},
						files: [fixture],
						include: [],
						exclude: [],
					}),
				);
				return spawnSync(
					pnpm,
					[
						"exec",
						"tsc",
						"--pretty",
						"false",
						"--project",
						configPath,
					],
					{ cwd: root, encoding: "utf8" },
				);
			} finally {
				rmSync(configDirectory, { recursive: true, force: true });
			}
		})();
		const output = `${result.stdout}${result.stderr}`;
		const diagnosticLines = output.trim().split(/\r?\n/);

		expect(result.status).not.toBe(0);
		expect(output).toContain("purchase_compeleted");
		expect(output).toContain("purchase_completed");
		expect(output).toContain("orderId");
		expect(output).toContain("amount");
		expect(diagnosticLines.length).toBeLessThan(30);
		expect(output).not.toContain("PropertiesForName");
		expect(output).not.toContain("DefinitionForName");
	});
});
