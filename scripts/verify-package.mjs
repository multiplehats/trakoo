import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertDeclarationImportsResolve,
	assertRootBundleNeutral,
} from "./package-verification.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invokedAsScript =
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const run = (command, args, cwd = root) =>
	execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });

const providerSdkPackages = [
	"@bentonow/bento-node-sdk",
	"@emitkit/js",
	"@openpanel/sdk",
	"@openpanel/web",
	"posthog-js",
	"posthog-node",
];

export function assertDeclarationTargetsExist(distDirectory, relativeTargets) {
	for (const relativeTarget of relativeTargets) {
		if (!existsSync(join(distDirectory, relativeTarget))) {
			throw new Error(`missing declaration target ${relativeTarget}`);
		}
	}
}

export function assertMitPackageLicense(manifest, licenseText) {
	if (manifest.license !== "MIT") {
		throw new Error(
			`packed trakoo declares ${manifest.license ?? "no"} license`,
		);
	}
	if (
		typeof licenseText !== "string" ||
		!licenseText.startsWith("MIT License")
	) {
		throw new Error("packed trakoo LICENSE is not the MIT license");
	}
}

export function assertOptionalProviderPeers(manifest, providerPackages) {
	for (const packageName of providerPackages) {
		if (
			typeof manifest.peerDependencies?.[packageName] !== "string" ||
			manifest.peerDependenciesMeta?.[packageName]?.optional !== true
		) {
			throw new Error(`${packageName} must be an optional peer dependency`);
		}
		if (manifest.dependencies?.[packageName]) {
			throw new Error(`${packageName} must not be a dependency`);
		}
		if (manifest.optionalDependencies?.[packageName]) {
			throw new Error(`${packageName} must not be an optionalDependency`);
		}
	}
}

export function assertProviderSdksAbsent(
	nodeModulesDirectory,
	providerPackages,
) {
	for (const packageName of providerPackages) {
		if (existsSync(join(nodeModulesDirectory, ...packageName.split("/")))) {
			throw new Error(`packed consumer unexpectedly installed ${packageName}`);
		}
	}
}

export function assertNoBundledProviderChunks(
	distDirectory,
	forbiddenNameFragments,
) {
	const pendingDirectories = [distDirectory];
	while (pendingDirectories.length > 0) {
		const directory = pendingDirectories.pop();
		if (!directory) continue;

		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				pendingDirectories.push(join(directory, entry.name));
				continue;
			}
			const matchingFragment = forbiddenNameFragments.find((fragment) =>
				entry.name.includes(fragment),
			);
			if (matchingFragment) {
				throw new Error(
					`bundled provider SDK chunk ${entry.name} contains ${matchingFragment}`,
				);
			}
		}
	}
}

const consumerSource = String.raw`
import { defineEvents, noProperties, typed } from "trakoo";
import {
	AnalyticsValidationError as ClientValidationError,
	createClientAnalytics,
	type ClientAnalyticsConfig,
	type EventInputMap as ClientEventInputMap,
} from "trakoo/client";
import {
	createServerAnalytics,
	type ServerAnalyticsConfig,
} from "trakoo/server";
import {
	BentoClientProvider,
	OpenPanelClientProvider,
	PirschClientProvider,
	PostHogClientProvider,
	ProxyProvider,
	VisitorsClientProvider,
	type BentoClientConfig,
	type OpenPanelClientConfig,
	type PirschClientConfig,
	type PostHogClientConfig,
	type PostHogConfig,
	type ProxyProviderConfig,
	type VisitorsClientConfig,
} from "trakoo/providers/client";
import {
	BentoServerProvider,
	EmitKitServerProvider,
	OpenPanelServerProvider,
	PirschServerProvider,
	PostHogServerProvider,
	type BentoServerConfig,
	type EmitKitServerConfig,
	type OpenPanelServerConfig,
	type PirschServerConfig,
	type PostHogOptions,
} from "trakoo/providers/server";

const events = defineEvents({
	clicked: {
		name: "clicked",
		category: "engagement",
		properties: typed<{ id: string }>(),
	},
	started: {
		name: "started",
		category: "user",
		properties: noProperties(),
	},
});

const analytics = createClientAnalytics({ events, providers: [] });
analytics.track("clicked", { id: "cta" });
analytics.track("started");

const serverAnalytics = createServerAnalytics({ events, providers: [] });
await serverAnalytics.track("clicked", { id: "server-cta" });
await serverAnalytics.track("started");

type ClickInput = ClientEventInputMap<typeof events>["clicked"];
void ({} as ClientAnalyticsConfig<typeof events>);
void ({} as ServerAnalyticsConfig<typeof events>);
void ({} as ClickInput);
void ClientValidationError;
void [
	BentoClientProvider,
	OpenPanelClientProvider,
	PirschClientProvider,
	PostHogClientProvider,
	ProxyProvider,
	VisitorsClientProvider,
	BentoServerProvider,
	EmitKitServerProvider,
	OpenPanelServerProvider,
	PirschServerProvider,
	PostHogServerProvider,
];
void ({} as BentoClientConfig);
void ({} as OpenPanelClientConfig);
void ({} as PirschClientConfig);
void ({} as PostHogClientConfig);
void ({} as PostHogConfig);
void ({} as ProxyProviderConfig);
void ({} as VisitorsClientConfig);
void ({} as BentoServerConfig);
void ({} as EmitKitServerConfig);
void ({} as OpenPanelServerConfig);
void ({} as PirschServerConfig);
void ({} as PostHogOptions);
`;

if (invokedAsScript) {
	const consumerDirectory = mkdtempSync(
		join(tmpdir(), "trakoo-package-consumer-"),
	);
	let tarballPath;

	try {
		run("pnpm", ["build"]);
		assertOptionalProviderPeers(
			JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
			providerSdkPackages,
		);
		assertNoBundledProviderChunks(join(root, "dist"), [
			"bento-node-sdk",
			"emitkit",
		]);
		assertDeclarationTargetsExist(join(root, "dist"), [
			"index.d.ts",
			"client/index.d.ts",
			"server/index.d.ts",
			"adapters/server/server-analytics.d.ts",
		]);
		assertDeclarationImportsResolve(join(root, "dist"));
		const packResult = JSON.parse(run("npm", ["pack", "--json"]));
		tarballPath = resolve(root, packResult[0].filename);

		run("npm", ["init", "-y"], consumerDirectory);
		run("npm", ["install", "--ignore-scripts", tarballPath], consumerDirectory);
		const consumerNodeModules = join(consumerDirectory, "node_modules");
		assertProviderSdksAbsent(consumerNodeModules, providerSdkPackages);

		writeFileSync(join(consumerDirectory, "consumer.ts"), consumerSource);
		writeFileSync(
			join(consumerDirectory, "tsconfig.json"),
			JSON.stringify(
				{
					compilerOptions: {
						strict: true,
						noEmit: true,
						target: "ES2022",
						module: "ESNext",
						moduleResolution: "Bundler",
						moduleDetection: "force",
						skipLibCheck: true,
					},
					include: ["consumer.ts"],
				},
				null,
				2,
			),
		);
		run(
			process.execPath,
			[
				resolve(root, "node_modules/typescript/bin/tsc"),
				"--project",
				join(consumerDirectory, "tsconfig.json"),
			],
			consumerDirectory,
		);

		const installedManifest = JSON.parse(
			readFileSync(join(consumerNodeModules, "trakoo/package.json"), "utf8"),
		);
		assertOptionalProviderPeers(installedManifest, providerSdkPackages);
		assertMitPackageLicense(
			installedManifest,
			readFileSync(join(consumerNodeModules, "trakoo/LICENSE"), "utf8"),
		);
		if (!installedManifest.dependencies?.["@standard-schema/spec"]) {
			throw new Error(
				"packed trakoo is missing @standard-schema/spec dependency",
			);
		}

		const concreteValidators = ["zod", "valibot", "arktype"];
		for (const field of [
			"dependencies",
			"optionalDependencies",
			"peerDependencies",
		]) {
			for (const packageName of concreteValidators) {
				if (installedManifest[field]?.[packageName]) {
					throw new Error(
						`packed trakoo declares concrete validator ${packageName}`,
					);
				}
			}
		}

		const installedDist = join(consumerNodeModules, "trakoo/dist");
		assertRootBundleNeutral(join(installedDist, "index.js"), installedDist, [
			...concreteValidators,
			"posthog-js",
			"posthog-node",
			"@openpanel/sdk",
			"@openpanel/web",
			"@bentonow/bento-node-sdk",
			"@emitkit/js",
		]);

		run(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				String.raw`
await import("trakoo");
await import("trakoo/client");
await import("trakoo/server");
await import("trakoo/providers/client");
await import("trakoo/providers/server");
`,
			],
			consumerDirectory,
		);

		run(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				String.raw`
const { PostHogServerProvider } = await import("trakoo/providers/server");
const provider = new PostHogServerProvider({
	apiKey: "PACKAGE_VERIFICATION_SECRET",
});
try {
	await provider.initialize();
	throw new Error("PostHog initialized without its optional peer");
} catch (error) {
	const message = error instanceof Error ? error.message : "";
	if (
		message !==
		"PostHog server provider requires the optional peer package posthog-node"
	) {
		throw error;
	}
	if (message.includes("PACKAGE_VERIFICATION_SECRET")) {
		throw new Error("missing-peer error exposed provider configuration");
	}
}
`,
			],
			consumerDirectory,
		);
	} finally {
		if (tarballPath) rmSync(tarballPath, { force: true });
		rmSync(consumerDirectory, { recursive: true, force: true });
	}
}
