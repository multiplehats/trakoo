import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumerDirectory = mkdtempSync(
	join(tmpdir(), "trakoo-package-consumer-"),
);
let tarballPath;

const run = (command, args, cwd = root) =>
	execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });

const consumerSource = String.raw`
import { defineEvents, noProperties, typed } from "trakoo";
import {
	AnalyticsValidationError as ClientValidationError,
	createClientAnalytics,
	type ClientAnalyticsConfig,
	type EventInputMap as ClientEventInputMap,
} from "trakoo/client";

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

type ClickInput = ClientEventInputMap<typeof events>["clicked"];
void ({} as ClientAnalyticsConfig<typeof events>);
void ({} as ClickInput);
void ClientValidationError;
`;

try {
	run("pnpm", ["build"]);
	const packResult = JSON.parse(run("npm", ["pack", "--json"]));
	tarballPath = resolve(root, packResult[0].filename);

	run("npm", ["init", "-y"], consumerDirectory);
	run(
		"npm",
		["install", "--ignore-scripts", tarballPath],
		consumerDirectory,
	);

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
		readFileSync(
			join(consumerDirectory, "node_modules/trakoo/package.json"),
			"utf8",
		),
	);
	if (!installedManifest.dependencies?.["@standard-schema/spec"]) {
		throw new Error("packed trakoo is missing @standard-schema/spec dependency");
	}
	const fontTypesManifest = JSON.parse(
		readFileSync(
			join(
				consumerDirectory,
				"node_modules/@types/css-font-loading-module/package.json",
			),
			"utf8",
		),
	);
	if (fontTypesManifest.version !== "0.0.13") {
		throw new Error(
			`packed consumer hoisted unexpected css font types ${fontTypesManifest.version}`,
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

	const rootBundle = readFileSync(
		join(consumerDirectory, "node_modules/trakoo/dist/index.js"),
		"utf8",
	);
	for (const prohibitedImport of [
		...concreteValidators,
		"posthog-js",
		"posthog-node",
		"@openpanel/sdk",
		"@openpanel/web",
	]) {
		if (rootBundle.includes(prohibitedImport)) {
			throw new Error(`root bundle includes ${prohibitedImport}`);
		}
	}

	// Prove root event helpers load without optional provider packages present.
	run("npm", ["prune", "--omit=optional"], consumerDirectory);
	writeFileSync(
		join(consumerDirectory, "consumer.ts"),
		String.raw`
import { defineEvents, typed } from "trakoo";

defineEvents({
	checked: {
		name: "checked",
		category: "test",
		properties: typed<{ value: string }>(),
	},
});
`,
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
	run(
		process.execPath,
		["--input-type=module", "--eval", 'await import("trakoo")'],
		consumerDirectory,
	);
} finally {
	if (tarballPath) rmSync(tarballPath, { force: true });
	rmSync(consumerDirectory, { recursive: true, force: true });
}
