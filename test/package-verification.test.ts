import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	assertDeclarationImportsResolve,
	assertRootBundleNeutral,
} from "../scripts/package-verification.mjs";
import * as packageVerifier from "../scripts/verify-package.mjs";

const {
	assertDeclarationTargetsExist,
	assertMitPackageLicense,
	assertNoBundledProviderChunks,
	assertOptionalProviderPeers,
	assertProviderSdksAbsent,
} = packageVerifier as typeof packageVerifier & {
	assertNoBundledProviderChunks: (
		distDirectory: string,
		forbiddenNameFragments: string[],
	) => void;
	assertOptionalProviderPeers: (
		manifest: Record<string, unknown>,
		providerPackages: string[],
	) => void;
	assertProviderSdksAbsent: (
		nodeModulesDirectory: string,
		providerPackages: string[],
	) => void;
};

const providerPackages = [
	"@bentonow/bento-node-sdk",
	"@emitkit/js",
	"@openpanel/sdk",
	"@openpanel/web",
	"posthog-js",
	"posthog-node",
];

describe("packed license verification", () => {
	it("accepts MIT package metadata and license text", () => {
		expect(() =>
			assertMitPackageLicense(
				{ license: "MIT" },
				"MIT License\n\nPermission is hereby granted...",
			),
		).not.toThrow();
	});

	it("rejects non-MIT package metadata", () => {
		expect(() =>
			assertMitPackageLicense({ license: "ISC" }, "MIT License"),
		).toThrow("packed trakoo declares ISC license");
	});

	it("rejects missing or non-MIT packed license text", () => {
		expect(() => assertMitPackageLicense({ license: "MIT" })).toThrow(
			"packed trakoo LICENSE is not the MIT license",
		);
		expect(() =>
			assertMitPackageLicense({ license: "MIT" }, "ISC License"),
		).toThrow("packed trakoo LICENSE is not the MIT license");
	});
});

describe("packed root bundle verification", () => {
	it("reports a missing declaration target", () => {
		const distDirectory = mkdtempSync(
			join(tmpdir(), "trakoo-declaration-targets-"),
		);
		try {
			mkdirSync(join(distDirectory, "client"));
			writeFileSync(join(distDirectory, "index.d.ts"), "export {};\n");
			writeFileSync(join(distDirectory, "client/index.d.ts"), "export {};\n");

			expect(() =>
				assertDeclarationTargetsExist(distDirectory, [
					"index.d.ts",
					"client/index.d.ts",
					"server/index.d.ts",
				]),
			).toThrow("server/index.d.ts");
		} finally {
			rmSync(distDirectory, { recursive: true, force: true });
		}
	});

	it("scans only the complete root-reachable static import graph", () => {
		const distDirectory = mkdtempSync(join(tmpdir(), "trakoo-root-graph-"));
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
			writeFileSync(join(distDirectory, "providers.js"), 'import "zod";');

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

describe("optional provider peer verification", () => {
	it("accepts SDKs only when every peer is marked optional", () => {
		const manifest = {
			peerDependencies: Object.fromEntries(
				providerPackages.map((packageName) => [packageName, "^1.0.0"]),
			),
			peerDependenciesMeta: Object.fromEntries(
				providerPackages.map((packageName) => [
					packageName,
					{ optional: true },
				]),
			),
		};

		expect(() =>
			assertOptionalProviderPeers(manifest, providerPackages),
		).not.toThrow();
	});

	it("rejects a provider SDK that is missing optional peer metadata", () => {
		expect(() =>
			assertOptionalProviderPeers(
				{
					peerDependencies: { "posthog-node": "^5.9.0" },
					peerDependenciesMeta: { "posthog-node": { optional: false } },
				},
				["posthog-node"],
			),
		).toThrow("posthog-node must be an optional peer dependency");
	});

	it("rejects provider SDKs from installable dependency fields", () => {
		expect(() =>
			assertOptionalProviderPeers(
				{
					peerDependencies: { "@emitkit/js": "^2.1.0" },
					peerDependenciesMeta: { "@emitkit/js": { optional: true } },
					optionalDependencies: { "@emitkit/js": "^2.1.0" },
				},
				["@emitkit/js"],
			),
		).toThrow("@emitkit/js must not be an optionalDependency");
	});

	it("detects scoped and unscoped provider SDK directories", () => {
		const nodeModulesDirectory = mkdtempSync(
			join(tmpdir(), "trakoo-provider-sdk-absence-"),
		);
		try {
			mkdirSync(join(nodeModulesDirectory, "@openpanel", "sdk"), {
				recursive: true,
			});
			expect(() =>
				assertProviderSdksAbsent(nodeModulesDirectory, ["@openpanel/sdk"]),
			).toThrow("@openpanel/sdk");

			rmSync(join(nodeModulesDirectory, "@openpanel"), {
				recursive: true,
				force: true,
			});
			mkdirSync(join(nodeModulesDirectory, "posthog-node"));
			expect(() =>
				assertProviderSdksAbsent(nodeModulesDirectory, ["posthog-node"]),
			).toThrow("posthog-node");

			rmSync(join(nodeModulesDirectory, "posthog-node"), {
				recursive: true,
				force: true,
			});
			expect(() =>
				assertProviderSdksAbsent(nodeModulesDirectory, providerPackages),
			).not.toThrow();
		} finally {
			rmSync(nodeModulesDirectory, { recursive: true, force: true });
		}
	});

	it("rejects provider implementation chunk filenames without scanning imports", () => {
		const distDirectory = mkdtempSync(
			join(tmpdir(), "trakoo-provider-chunks-"),
		);
		try {
			mkdirSync(join(distDirectory, "chunks"));
			writeFileSync(
				join(distDirectory, "providers.js"),
				'import("@bentonow/bento-node-sdk"); import("@emitkit/js");',
			);
			expect(() =>
				assertNoBundledProviderChunks(distDirectory, [
					"bento-node-sdk",
					"emitkit",
				]),
			).not.toThrow();

			writeFileSync(
				join(distDirectory, "chunks", "bento-node-sdk-abc123.js"),
				"export {};",
			);
			expect(() =>
				assertNoBundledProviderChunks(distDirectory, [
					"bento-node-sdk",
					"emitkit",
				]),
			).toThrow("bento-node-sdk-abc123.js");
		} finally {
			rmSync(distDirectory, { recursive: true, force: true });
		}
	});
});

describe("declaration import verification", () => {
	const withDist = (files: Record<string, string>) => {
		const dist = mkdtempSync(join(tmpdir(), "trakoo-dts-"));
		for (const [relativePath, contents] of Object.entries(files)) {
			const target = join(dist, relativePath);
			mkdirSync(join(target, ".."), { recursive: true });
			writeFileSync(target, contents);
		}
		return dist;
	};

	it("accepts declarations whose relative imports were emitted", () => {
		const dist = withDist({
			"providers/client.d.ts":
				'export type { A } from "./openpanel/transport.js";',
			"providers/openpanel/transport.d.ts": "export type A = string;",
		});

		try {
			expect(() => assertDeclarationImportsResolve(dist)).not.toThrow();
		} finally {
			rmSync(dist, { recursive: true, force: true });
		}
	});

	it("rejects a declaration the build silently dropped", () => {
		// `vite build` exits 0 when a source file fails isolatedDeclarations, so
		// the importer ships while the type it names does not.
		const dist = withDist({
			"providers/client.d.ts":
				'export type { A } from "./openpanel/transport.js";',
		});

		try {
			expect(() => assertDeclarationImportsResolve(dist)).toThrow(
				/transport\.d\.ts was not emitted/,
			);
		} finally {
			rmSync(dist, { recursive: true, force: true });
		}
	});

	it("ignores bare package imports", () => {
		const dist = withDist({
			"index.d.ts": 'import type { OpenPanel } from "@openpanel/sdk";',
		});

		try {
			expect(() => assertDeclarationImportsResolve(dist)).not.toThrow();
		} finally {
			rmSync(dist, { recursive: true, force: true });
		}
	});
});
