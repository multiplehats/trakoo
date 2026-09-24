import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAdapterPackages } from "../scripts/adapter-packages.mjs";
import {
	assertDeclarationImportsResolve,
	assertRootBundleNeutral,
	referencedPackages,
} from "../scripts/package-verification.mjs";
import {
	assertCoreDeclaresNoProviderSdks,
	assertDeclarationTargetsExist,
	assertMitPackageLicense,
	assertPackedAdapterManifest,
	assertProviderSdksAbsent,
	ownedDiagnostics,
} from "../scripts/verify-package.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

describe("core manifest verification", () => {
	it("accepts a manifest that names no provider SDK", () => {
		expect(() =>
			assertCoreDeclaresNoProviderSdks(
				{ dependencies: { "@standard-schema/spec": "^1.1.0" } },
				providerPackages,
			),
		).not.toThrow();
	});

	it.each([
		"dependencies",
		"optionalDependencies",
		"peerDependencies",
		"peerDependenciesMeta",
	])("rejects a provider SDK in %s", (field) => {
		expect(() =>
			assertCoreDeclaresNoProviderSdks(
				{ [field]: { "posthog-node": "^5.9.0" } },
				providerPackages,
			),
		).toThrow(`trakoo must not declare posthog-node in ${field}`);
	});
});

describe("packed adapter manifest verification", () => {
	const packedAdapter = (overrides: Record<string, unknown> = {}) => ({
		name: "@trakoo/posthog",
		peerDependencies: {
			trakoo: "^2.0.0",
			"posthog-js": "^1.268.2",
		},
		peerDependenciesMeta: { "posthog-js": { optional: true } },
		...overrides,
	});

	it("accepts a concrete trakoo peer range", () => {
		expect(() =>
			assertPackedAdapterManifest(packedAdapter(), "2.0.0"),
		).not.toThrow();
	});

	it("rejects an unpublished workspace protocol", () => {
		expect(() =>
			assertPackedAdapterManifest(
				packedAdapter({
					peerDependencies: { trakoo: "workspace:^" },
				}),
				"2.0.0",
			),
		).toThrow("publishes trakoo@workspace:^ in peerDependencies");
	});

	it("rejects a trakoo peer that does not match the core release", () => {
		expect(() =>
			assertPackedAdapterManifest(
				packedAdapter({ peerDependencies: { trakoo: "^1.2.1" } }),
				"2.0.0",
			),
		).toThrow("must peer on trakoo@^2.0.0, found ^1.2.1");
	});

	it("rejects an adapter that installs its own SDK", () => {
		expect(() =>
			assertPackedAdapterManifest(
				packedAdapter({ dependencies: { "posthog-js": "^1.268.2" } }),
				"2.0.0",
			),
		).toThrow("must not install its peer posthog-js through dependencies");
	});
});

describe("adapter package discovery", () => {
	it("reads every adapter with its SDK peers", () => {
		const adapters = readAdapterPackages(repositoryRoot);

		expect(adapters.map((adapter) => adapter.name)).toEqual([
			"@trakoo/bento",
			"@trakoo/emitkit",
			"@trakoo/openpanel",
			"@trakoo/posthog",
		]);
		expect(
			adapters.flatMap((adapter) => adapter.sdkPeers.map((peer) => peer.name)),
		).toEqual(providerPackages);
		for (const adapter of adapters) {
			expect(adapter.manifest.peerDependencies.trakoo).toBe("workspace:^");
			for (const peer of adapter.sdkPeers) {
				expect(peer.testedRange).toBeDefined();
			}
		}
	});
});

describe("provider SDK absence", () => {
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
});

describe("entry SDK discovery", () => {
	it("finds static and dynamic SDK imports across relative modules", () => {
		const distDirectory = mkdtempSync(join(tmpdir(), "trakoo-entry-sdks-"));
		try {
			writeFileSync(
				join(distDirectory, "server.js"),
				'import { share } from "./shared.js";\nconst sdk = await import("@openpanel/sdk");',
			);
			writeFileSync(
				join(distDirectory, "shared.js"),
				'import "@openpanel/web/extras";',
			);
			writeFileSync(join(distDirectory, "client.js"), 'import("posthog-js");');

			expect(
				referencedPackages(join(distDirectory, "server.js"), distDirectory, [
					"@openpanel/sdk",
					"@openpanel/web",
					"posthog-js",
				]),
			).toEqual(["@openpanel/sdk", "@openpanel/web"]);
		} finally {
			rmSync(distDirectory, { recursive: true, force: true });
		}
	});

	it("does not match a package whose name only shares a prefix", () => {
		const distDirectory = mkdtempSync(join(tmpdir(), "trakoo-entry-sdks-"));
		try {
			writeFileSync(
				join(distDirectory, "client.js"),
				'import("posthog-js-lite");',
			);
			expect(
				referencedPackages(join(distDirectory, "client.js"), distDirectory, [
					"posthog-js",
				]),
			).toEqual([]);
		} finally {
			rmSync(distDirectory, { recursive: true, force: true });
		}
	});
});

describe("consumer diagnostics", () => {
	it("keeps consumer and trakoo diagnostics and drops third-party ones", () => {
		const output = [
			"node_modules/.pnpm/posthog-node@5.52.5/node_modules/posthog-node/dist/extensions/express.d.ts(2,40): error TS2307: Cannot find module 'express'.",
			"node_modules/.pnpm/@trakoo+posthog@file+x/node_modules/@trakoo/posthog/dist/client.d.ts(26,37): error TS2307: Cannot find module 'posthog-node'.",
			"node_modules/trakoo/dist/client/index.d.ts(12,36): error TS2307: Cannot find module 'posthog-js'.",
			"consumer.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.",
			"  Continuation line for the consumer diagnostic.",
		].join("\n");

		expect(ownedDiagnostics(output)).toEqual([
			"node_modules/.pnpm/@trakoo+posthog@file+x/node_modules/@trakoo/posthog/dist/client.d.ts(26,37): error TS2307: Cannot find module 'posthog-node'.",
			"node_modules/trakoo/dist/client/index.d.ts(12,36): error TS2307: Cannot find module 'posthog-js'.",
			"consumer.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.",
			"  Continuation line for the consumer diagnostic.",
		]);
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
