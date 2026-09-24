import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { readAdapterPackages } from "./adapter-packages.mjs";

/**
 * Keeps each adapter's SDK support current.
 *
 *   matrix        Every SDK version an adapter claims to support and must be
 *                 tested against: the oldest release in each `||` part of the
 *                 peer range, plus the newest release the range accepts.
 *   plan          Adapters whose SDKs published a release newer than the one
 *                 the adapter is tested against.
 *   apply <name>  Moves that adapter's tested SDKs to their latest releases,
 *                 widens a peer range the release falls outside of, and
 *                 records a changeset for the widened support.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invokedAsScript =
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * The versions a peer range promises: the oldest published release of each
 * `||` part, and the newest published release overall. Prereleases are never
 * selected.
 */
export function supportedVersions(range, publishedVersions) {
	const parts = range.split("||").map((part) => part.trim());
	const candidates = parts.map((part) => ({
		label: parts.length > 1 ? `oldest ${part}` : "oldest",
		version: semver.minSatisfying(publishedVersions, part),
	}));
	candidates.push({
		label: "newest",
		version: semver.maxSatisfying(publishedVersions, range),
	});

	const seen = new Set();
	return candidates.filter(({ label, version }) => {
		if (!version) throw new Error(`no published release satisfies ${label}`);
		if (seen.has(version)) return false;
		seen.add(version);
		return true;
	});
}

/**
 * What moving one SDK peer to `latest` changes, or `null` when the adapter is
 * already tested against it. A peer range is only ever widened, with the new
 * release as the floor of the added part, so every claimed version stays one
 * the matrix has run.
 */
export function planSdkUpdate(peer, latest) {
	const testedFloor = semver.minVersion(peer.testedRange ?? peer.range);
	if (!testedFloor || !semver.gt(latest, testedFloor)) return null;

	const widened = !semver.satisfies(latest, peer.range);
	return {
		name: peer.name,
		latest,
		testedRange: { from: peer.testedRange, to: `^${latest}` },
		range: {
			from: peer.range,
			to: widened ? `${peer.range} || ^${latest}` : peer.range,
		},
		widened,
	};
}

export function applyUpdatesToManifest(manifest, updates) {
	const next = structuredClone(manifest);
	for (const update of updates) {
		next.devDependencies[update.name] = update.testedRange.to;
		next.peerDependencies[update.name] = update.range.to;
	}
	return next;
}

export function upkeepChangeset(packageName, updates) {
	const widened = updates.filter((update) => update.widened);
	if (widened.length === 0) return null;

	const lines = widened.map(
		(update) =>
			`Support ${update.name} ${releaseLine(update.latest)} (peer range \`${update.range.to}\`)`,
	);
	return `---\n"${packageName}": minor\n---\n\n${lines.join("\n\n")}\n`;
}

/**
 * Named after the releases it adds, so a later run cannot overwrite a changeset
 * that is still waiting to be released.
 */
export function upkeepChangesetName(slug, updates) {
	const releases = updates
		.filter((update) => update.widened)
		.map(
			(update) =>
				`${update.name.replace(/^@/, "").replace(/\//g, "-")}-${update.latest}`,
		)
		.join("-");
	return `upkeep-${slug}-${releases}.md`;
}

/** The part of a version a caret range moves within: `6` for 6.1.0, `0.3` for 0.3.2. */
function releaseLine(version) {
	const major = semver.major(version);
	return major > 0 ? `${major}` : `0.${semver.minor(version)}`;
}

export function upkeepSummary(packageName, updates) {
	const widened = updates.filter((update) => update.widened);
	const title =
		widened.length > 0
			? `feat(${packageName}): support ${widened.map((update) => `${update.name}@${update.latest}`).join(", ")}`
			: `chore(${packageName}): test against ${updates.map((update) => `${update.name}@${update.latest}`).join(", ")}`;
	const rows = updates.map(
		(update) =>
			`| \`${update.name}\` | \`${update.testedRange.from}\` → \`${update.testedRange.to}\` | ${update.widened ? `\`${update.range.from}\` → \`${update.range.to}\`` : "unchanged"} |`,
	);
	const body = [
		`Moves \`${packageName}\` onto the latest SDK releases.`,
		"",
		"| SDK | Tested against | Peer range |",
		"| --- | --- | --- |",
		...rows,
		"",
		widened.length > 0
			? "The peer range only widens, so existing users keep their current SDK. A changeset records the new support as a minor release."
			: "The peer range already accepts these releases, so users see no change and no changeset is needed.",
	].join("\n");
	return { title, body };
}

const npmView = (packageName, field) =>
	JSON.parse(
		execFileSync("npm", ["view", packageName, field, "--json"], {
			encoding: "utf8",
		}),
	);

function planAdapter(adapter) {
	return adapter.sdkPeers
		.map((peer) => planSdkUpdate(peer, npmView(peer.name, "dist-tags.latest")))
		.filter(Boolean);
}

function writeGithubOutput(values) {
	const outputFile = process.env.GITHUB_OUTPUT;
	if (!outputFile) {
		console.log(JSON.stringify(values, null, 2));
		return;
	}
	for (const [name, value] of Object.entries(values)) {
		const delimiter = `EOF_${randomUUID()}`;
		appendFileSync(
			outputFile,
			`${name}<<${delimiter}\n${value}\n${delimiter}\n`,
		);
	}
}

function main([command, adapterName]) {
	const adapters = readAdapterPackages(root);

	if (command === "matrix") {
		const include = adapters.flatMap((adapter) =>
			adapter.sdkPeers.flatMap((peer) =>
				supportedVersions(peer.range, npmView(peer.name, "versions")).map(
					({ label, version }) => ({
						adapter: adapter.name,
						sdk: peer.name,
						version,
						label,
					}),
				),
			),
		);
		console.log(JSON.stringify(include));
		return;
	}

	if (command === "plan") {
		const outdated = adapters
			.filter((adapter) => planAdapter(adapter).length > 0)
			.map((adapter) => adapter.name);
		console.log(JSON.stringify(outdated));
		return;
	}

	if (command === "apply") {
		const adapter = adapters.find(
			(candidate) => candidate.name === adapterName,
		);
		if (!adapter) throw new Error(`unknown adapter ${adapterName}`);
		const updates = planAdapter(adapter);
		if (updates.length === 0) {
			writeGithubOutput({ changed: "false" });
			return;
		}

		writeFileSync(
			adapter.manifestPath,
			`${JSON.stringify(applyUpdatesToManifest(adapter.manifest, updates), null, "\t")}\n`,
		);
		execFileSync("pnpm", ["biome", "format", "--write", adapter.manifestPath], {
			cwd: root,
			stdio: "ignore",
		});

		const slug = adapter.relativeDirectory.split("/").pop();
		const changeset = upkeepChangeset(adapter.name, updates);
		if (changeset) {
			writeFileSync(
				join(root, ".changeset", upkeepChangesetName(slug, updates)),
				changeset,
			);
		}

		const { title, body } = upkeepSummary(adapter.name, updates);
		writeGithubOutput({
			changed: "true",
			branch: `upkeep/${slug}`,
			title,
			body,
		});
		return;
	}

	throw new Error("usage: adapter-upkeep.mjs matrix | plan | apply <adapter>");
}

if (invokedAsScript) main(process.argv.slice(2));
