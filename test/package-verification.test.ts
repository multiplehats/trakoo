import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertRootBundleNeutral } from "../scripts/package-verification.mjs";

describe("packed root bundle verification", () => {
	it("scans only the complete root-reachable static import graph", () => {
		const distDirectory = mkdtempSync(
			join(tmpdir(), "trakoo-root-graph-"),
		);
		try {
			mkdirSync(join(distDirectory, "chunks"));
			writeFileSync(
				join(distDirectory, "index.js"),
				'import"./chunks/registry.js";',
			);
			writeFileSync(
				join(distDirectory, "chunks/registry.js"),
				'import"../index.js";export*from"./validation.js";',
			);
			writeFileSync(
				join(distDirectory, "chunks/validation.js"),
				'import "@bentonow/bento-node-sdk";',
			);
			writeFileSync(
				join(distDirectory, "providers.js"),
				'import "zod";',
			);

			expect(() =>
				assertRootBundleNeutral(
					join(distDirectory, "index.js"),
					distDirectory,
					["zod", "@bentonow/bento-node-sdk"],
				),
			).toThrow(
				"root bundle includes @bentonow/bento-node-sdk in chunks/validation.js",
			);
		} finally {
			rmSync(distDirectory, { recursive: true, force: true });
		}
	});
});
