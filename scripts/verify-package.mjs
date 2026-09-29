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
import { readAdapterPackages, readJson } from "./adapter-packages.mjs";
import {
	assertDeclarationImportsResolve,
	assertRootBundleNeutral,
	referencedPackages,
} from "./package-verification.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invokedAsScript =
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const run = (command, args, cwd = root) =>
	execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });

const installableDependencyFields = [
	"dependencies",
	"optionalDependencies",
	"peerDependencies",
];

/** The first of `packageNames` that `manifest` declares in one of `fields`. */
function findDeclaration(manifest, fields, packageNames) {
	for (const field of fields) {
		const packageName = packageNames.find((name) => manifest[field]?.[name]);
		if (packageName) return { field, packageName };
	}
	return undefined;
}

export function assertDeclarationTargetsExist(distDirectory, relativeTargets) {
	for (const relativeTarget of relativeTargets) {
		if (!existsSync(join(distDirectory, relativeTarget))) {
			throw new Error(`missing declaration target ${relativeTarget}`);
		}
	}
}

export function assertMitPackageLicense(manifest, licenseText) {
	const packageName = manifest.name ?? "trakoo";
	if (manifest.license !== "MIT") {
		throw new Error(
			`packed ${packageName} declares ${manifest.license ?? "no"} license`,
		);
	}
	if (
		typeof licenseText !== "string" ||
		!licenseText.startsWith("MIT License")
	) {
		throw new Error(`packed ${packageName} LICENSE is not the MIT license`);
	}
}

/**
 * Core must not name any provider SDK in a field a package manager reads, or
 * installing one provider's SDK can conflict with core itself.
 */
export function assertCoreDeclaresNoProviderSdks(manifest, providerPackages) {
	const declared = findDeclaration(
		manifest,
		[...installableDependencyFields, "peerDependenciesMeta"],
		providerPackages,
	);
	if (declared) {
		throw new Error(
			`trakoo must not declare ${declared.packageName} in ${declared.field}`,
		);
	}
}

/**
 * A packed adapter peers on a concrete `trakoo` range and never installs its
 * SDK itself.
 */
export function assertPackedAdapterManifest(manifest, coreVersion) {
	for (const field of [...installableDependencyFields, "devDependencies"]) {
		for (const [packageName, range] of Object.entries(manifest[field] ?? {})) {
			if (String(range).startsWith("workspace:")) {
				throw new Error(
					`${manifest.name} publishes ${packageName}@${range} in ${field}`,
				);
			}
		}
	}

	const expectedCoreRange = `^${coreVersion}`;
	if (manifest.peerDependencies?.trakoo !== expectedCoreRange) {
		throw new Error(
			`${manifest.name} must peer on trakoo@${expectedCoreRange}, found ${manifest.peerDependencies?.trakoo ?? "none"}`,
		);
	}
	if (manifest.dependencies?.trakoo) {
		throw new Error(`${manifest.name} must not depend on trakoo directly`);
	}

	const installedPeer = findDeclaration(
		manifest,
		["dependencies", "optionalDependencies"],
		Object.keys(manifest.peerDependencies),
	);
	if (installedPeer) {
		throw new Error(
			`${manifest.name} must not install its peer ${installedPeer.packageName} through ${installedPeer.field}`,
		);
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

/**
 * Consumers type-check with `skipLibCheck: false`, so an unresolved import in a
 * published declaration fails instead of silently becoming `any`.
 */
const consumerCompilerOptions = {
	strict: true,
	noEmit: true,
	target: "ES2022",
	lib: ["ES2022", "DOM"],
	module: "ESNext",
	moduleResolution: "Bundler",
	moduleDetection: "force",
	skipLibCheck: false,
	types: [],
};

const coreConsumerSource = String.raw`
import {
	BaseAnalyticsProvider as RootBaseAnalyticsProvider,
	defineEvents,
	noProperties,
	typed,
} from "trakoo";
import {
	AnalyticsValidationError as ClientValidationError,
	BaseAnalyticsProvider,
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
	PirschClientProvider,
	ProxyProvider,
	VisitorsClientProvider,
	type BentoClientConfig,
	type PirschClientConfig,
	type ProxyProviderConfig,
	type VisitorsClientConfig,
} from "trakoo/providers/client";
import {
	PirschServerProvider,
	createProxyHandler,
	type PirschServerConfig,
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
	RootBaseAnalyticsProvider,
	BaseAnalyticsProvider,
	BentoClientProvider,
	PirschClientProvider,
	ProxyProvider,
	VisitorsClientProvider,
	PirschServerProvider,
	createProxyHandler,
];
void ({} as BentoClientConfig);
void ({} as PirschClientConfig);
void ({} as ProxyProviderConfig);
void ({} as VisitorsClientConfig);
void ({} as PirschServerConfig);
`;

/**
 * Every provider class an adapter entry exports must satisfy core's provider
 * contract, resolved from the installed packages rather than workspace source.
 */
const adapterConsumerSource = (specifier) => String.raw`
import type { AnalyticsProvider } from "trakoo";
import * as adapter from "${specifier}";

type ExportedProvider = {
	[Name in keyof typeof adapter]: (typeof adapter)[Name] extends abstract new (
		...args: never
	) => infer Instance
		? Instance
		: never;
}[keyof typeof adapter];

const exportsProvider: [ExportedProvider] extends [never] ? false : true = true;
const providers: AnalyticsProvider[] = [] as ExportedProvider[];
void [exportsProvider, providers];
`;

/**
 * Integrations export something other than providers, so each one type-checks
 * its own consumer: the setup its README shows, resolved from the packed
 * packages.
 */
const integrationConsumerSources = {
	"@trakoo/better-auth": (specifier) => String.raw`
import { betterAuth } from "better-auth";
import { defineEvents, typed } from "trakoo";
import { createServerAnalytics } from "trakoo/server";
import { authEvents, trakooAuth, type AuthEventKey } from "${specifier}";

const events = defineEvents({
	...authEvents,
	checkoutCompleted: {
		name: "checkout_completed",
		category: "conversion",
		properties: typed<{ orderId: string }>(),
	},
});
const analytics = createServerAnalytics({ events, providers: [] });
await analytics.track("user_signed_up", { method: "email", emailVerified: false });

export const auth = betterAuth({
	plugins: [
		trakooAuth({
			analytics,
			exclude: ["userSignedOut"] satisfies AuthEventKey[],
			emitkit: { notify: ["userSignedUp"] },
		}),
	],
});

const withoutAuthEvents = createServerAnalytics({
	events: defineEvents({}),
	providers: [],
});
// @ts-expect-error the registry must include authEvents
trakooAuth({ analytics: withoutAuthEvents });
`,
};

/** The import specifier and built file of an adapter entry. */
function entryModule(adapter, entry) {
	return entry === "."
		? { specifier: adapter.name, file: "index" }
		: { specifier: `${adapter.name}/${entry}`, file: entry };
}

const diagnosticPattern = /^(.+?)\(\d+,\d+\): error TS\d+:/;
const ownedFilePattern = /(?:^|\/)node_modules\/(?:trakoo|@trakoo\/[^/]+)\//;

/**
 * Keeps diagnostics from the consumer and trakoo's own declarations. Checking
 * library files also surfaces defects in third-party SDK declarations (for
 * example posthog-node's optional express types), which trakoo cannot fix.
 */
export function ownedDiagnostics(compilerOutput) {
	const diagnostics = [];
	let owned = false;
	for (const line of compilerOutput.split("\n")) {
		const match = diagnosticPattern.exec(line);
		if (match) {
			owned =
				match[1] === "consumer.ts" || ownedFilePattern.test(match[1] ?? "");
		}
		if (owned && line.trim()) diagnostics.push(line);
	}
	return diagnostics;
}

function typecheckConsumer(consumerDirectory, source) {
	writeFileSync(join(consumerDirectory, "consumer.ts"), source);
	writeFileSync(
		join(consumerDirectory, "tsconfig.json"),
		JSON.stringify(
			{ compilerOptions: consumerCompilerOptions, include: ["consumer.ts"] },
			null,
			2,
		),
	);
	try {
		run(
			process.execPath,
			[
				resolve(root, "node_modules/typescript/bin/tsc"),
				"--project",
				join(consumerDirectory, "tsconfig.json"),
			],
			consumerDirectory,
		);
	} catch (error) {
		const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
		if (!diagnosticPattern.test(output.split("\n")[0] ?? "")) throw error;
		const diagnostics = ownedDiagnostics(output);
		if (diagnostics.length > 0) {
			throw new Error(`consumer type-check failed:\n${diagnostics.join("\n")}`);
		}
	}
}

function packWithPnpm(packageDirectory, destination) {
	const before = new Set(readdirSync(destination));
	run("pnpm", ["pack", "--pack-destination", destination], packageDirectory);
	const created = readdirSync(destination).filter(
		(file) => file.endsWith(".tgz") && !before.has(file),
	);
	if (created.length !== 1) {
		throw new Error(`expected one tarball from ${packageDirectory}`);
	}
	return join(destination, created[0]);
}

function packedManifest(tarballPath) {
	return JSON.parse(run("tar", ["-xzOf", tarballPath, "package/package.json"]));
}

function createConsumer(directories, prefix) {
	const consumerDirectory = mkdtempSync(join(tmpdir(), prefix));
	directories.push(consumerDirectory);
	writeFileSync(
		join(consumerDirectory, "package.json"),
		JSON.stringify({ name: "consumer", private: true, type: "module" }),
	);
	return consumerDirectory;
}

function runModule(consumerDirectory, source) {
	run(
		process.execPath,
		["--input-type=module", "--eval", source],
		consumerDirectory,
	);
}

function verifyCore(tarballPath, consumerDirectory, providerPackages) {
	run("npm", ["install", "--ignore-scripts", tarballPath], consumerDirectory);
	const consumerNodeModules = join(consumerDirectory, "node_modules");
	assertProviderSdksAbsent(consumerNodeModules, providerPackages);
	typecheckConsumer(consumerDirectory, coreConsumerSource);

	const installedManifest = readJson(
		join(consumerNodeModules, "trakoo/package.json"),
	);
	assertCoreDeclaresNoProviderSdks(installedManifest, providerPackages);
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
	const validator = findDeclaration(
		installedManifest,
		installableDependencyFields,
		concreteValidators,
	);
	if (validator) {
		throw new Error(
			`packed trakoo declares concrete validator ${validator.packageName}`,
		);
	}

	const installedDist = join(consumerNodeModules, "trakoo/dist");
	assertRootBundleNeutral(join(installedDist, "index.js"), installedDist, [
		...concreteValidators,
		...providerPackages,
	]);

	runModule(
		consumerDirectory,
		String.raw`
await import("trakoo");
await import("trakoo/client");
await import("trakoo/server");
await import("trakoo/providers/client");
await import("trakoo/providers/server");
`,
	);
}

/**
 * Installs one adapter entry the way a user of only that entry would: core,
 * the adapter, and the SDKs the entry imports. A declaration that reaches for
 * a sibling entry's SDK then fails to resolve. Hoisting is off so undeclared
 * packages stay unresolvable, as under Yarn PnP.
 */
function verifyAdapterEntry({
	adapter,
	entry,
	coreTarball,
	adapterTarball,
	consumerDirectory,
	typesNodeRange,
}) {
	const { specifier, file } = entryModule(adapter, entry);
	const sdkNames = adapter.sdkPeers.map((peer) => peer.name);
	const entrySdks = referencedPackages(
		join(adapter.directory, "dist", `${file}.js`),
		join(adapter.directory, "dist"),
		sdkNames,
	);
	if (entrySdks.length === 0) {
		throw new Error(`${specifier} imports none of its SDK peers`);
	}

	const sdkInstalls = adapter.sdkPeers
		.filter((peer) => entrySdks.includes(peer.name))
		.map((peer) => `${peer.name}@${peer.testedRange ?? peer.range}`);
	run(
		"pnpm",
		[
			"add",
			"--ignore-scripts",
			"--config.hoist=false",
			coreTarball,
			adapterTarball,
			...sdkInstalls,
			`@types/node@${typesNodeRange}`,
		],
		consumerDirectory,
	);

	const nodeModules = join(consumerDirectory, "node_modules");
	const unrelatedSdks = adapter.sdkPeers
		.filter((peer) => peer.optional && !entrySdks.includes(peer.name))
		.map((peer) => peer.name);
	assertProviderSdksAbsent(nodeModules, unrelatedSdks);

	const installedLicense = join(nodeModules, adapter.name, "LICENSE");
	assertMitPackageLicense(
		readJson(join(nodeModules, adapter.name, "package.json")),
		existsSync(installedLicense)
			? readFileSync(installedLicense, "utf8")
			: undefined,
	);

	const consumerSource =
		integrationConsumerSources[adapter.name] ?? adapterConsumerSource;
	typecheckConsumer(
		consumerDirectory,
		`/// <reference types="node" />\n${consumerSource(specifier)}`,
	);

	// Importing a sibling entry must stay safe even though its SDK is absent.
	runModule(
		consumerDirectory,
		adapter.entries
			.map((name) => `await import("${entryModule(adapter, name).specifier}");`)
			.join("\n"),
	);

	return unrelatedSdks;
}

/**
 * A PostHog client consumer has no posthog-node, so the server entry must fail
 * with the missing-peer error and without echoing its configuration.
 */
function verifyPostHogServerWithoutItsPeer(consumerDirectory, unrelatedSdks) {
	if (!unrelatedSdks.includes("posthog-node")) {
		throw new Error("PostHog client consumer installed posthog-node");
	}
	runModule(
		consumerDirectory,
		String.raw`
const { PostHogServerProvider } = await import("@trakoo/posthog/server");
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
	);
}

/**
 * Regression: npm rejects an install when any declared peer, optional or not,
 * conflicts with a version already in the project. An OpenPanel user with an
 * unrelated posthog-node@4 must still be able to install trakoo.
 */
function verifyUnrelatedPeerRegression({
	adapters,
	coreTarball,
	adapterTarballs,
	consumerDirectory,
}) {
	const openPanel = adapters.find(
		(adapter) => adapter.name === "@trakoo/openpanel",
	);
	if (!openPanel) throw new Error("missing @trakoo/openpanel adapter");
	run(
		"npm",
		["install", "--ignore-scripts", "posthog-node@4"],
		consumerDirectory,
	);
	const openPanelServerSdk = openPanel.sdkPeers.find(
		(peer) => peer.name === "@openpanel/sdk",
	);
	run(
		"npm",
		[
			"install",
			"--ignore-scripts",
			coreTarball,
			adapterTarballs.get(openPanel.name),
			`@openpanel/sdk@${openPanelServerSdk?.testedRange}`,
		],
		consumerDirectory,
	);
}

if (invokedAsScript) {
	const temporaryDirectories = [];
	const tarballDirectory = mkdtempSync(join(tmpdir(), "trakoo-tarballs-"));
	temporaryDirectories.push(tarballDirectory);

	try {
		run("pnpm", ["build"]);
		const coreManifest = readJson(join(root, "package.json"));
		const adapters = readAdapterPackages(root);
		const providerPackages = adapters.flatMap((adapter) =>
			adapter.sdkPeers.map((peer) => peer.name),
		);

		assertCoreDeclaresNoProviderSdks(coreManifest, providerPackages);
		assertDeclarationTargetsExist(join(root, "dist"), [
			"index.d.ts",
			"client/index.d.ts",
			"server/index.d.ts",
			"adapters/server/server-analytics.d.ts",
		]);
		assertDeclarationImportsResolve(join(root, "dist"));

		const coreTarball = packWithPnpm(root, tarballDirectory);
		verifyCore(
			coreTarball,
			createConsumer(temporaryDirectories, "trakoo-core-consumer-"),
			providerPackages,
		);

		const adapterTarballs = new Map();
		for (const adapter of adapters) {
			assertDeclarationImportsResolve(join(adapter.directory, "dist"));
			const adapterTarball = packWithPnpm(adapter.directory, tarballDirectory);
			adapterTarballs.set(adapter.name, adapterTarball);
			assertPackedAdapterManifest(
				packedManifest(adapterTarball),
				coreManifest.version,
			);

			for (const entry of adapter.entries) {
				const consumerDirectory = createConsumer(
					temporaryDirectories,
					"trakoo-adapter-consumer-",
				);
				const unrelatedSdks = verifyAdapterEntry({
					adapter,
					entry,
					coreTarball,
					adapterTarball,
					consumerDirectory,
					typesNodeRange: coreManifest.devDependencies["@types/node"],
				});

				if (adapter.name === "@trakoo/posthog" && entry === "client") {
					verifyPostHogServerWithoutItsPeer(consumerDirectory, unrelatedSdks);
				}
			}
		}

		verifyUnrelatedPeerRegression({
			adapters,
			coreTarball,
			adapterTarballs,
			consumerDirectory: createConsumer(
				temporaryDirectories,
				"trakoo-unrelated-peer-consumer-",
			),
		});
	} finally {
		for (const directory of temporaryDirectories) {
			rmSync(directory, { recursive: true, force: true });
		}
	}
}
