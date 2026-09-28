import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const readJson = (filePath) =>
	JSON.parse(readFileSync(filePath, "utf8"));

/**
 * Reads every adapter package under `packages/`. An adapter's SDK peers are
 * all of its peer dependencies except `trakoo` itself.
 */
export function readAdapterPackages(root) {
	const packagesDirectory = join(root, "packages");
	return readdirSync(packagesDirectory, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				existsSync(join(packagesDirectory, entry.name, "package.json")),
		)
		.map((entry) => {
			const directory = join(packagesDirectory, entry.name);
			const manifestPath = join(directory, "package.json");
			const manifest = readJson(manifestPath);
			return {
				name: manifest.name,
				slug: entry.name,
				directory,
				manifestPath,
				manifest,
				entries: Object.keys(manifest.exports ?? {}).map((subpath) =>
					subpath.replace(/^\.\//, ""),
				),
				sdkPeers: sdkPeers(manifest),
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function sdkPeers(manifest) {
	return Object.entries(manifest.peerDependencies ?? {})
		.filter(([packageName]) => packageName !== "trakoo")
		.map(([packageName, range]) => ({
			name: packageName,
			range,
			optional: manifest.peerDependenciesMeta?.[packageName]?.optional === true,
			testedRange: manifest.devDependencies?.[packageName],
		}));
}
