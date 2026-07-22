import { readFileSync } from "node:fs";
import {
	dirname,
	extname,
	isAbsolute,
	relative,
	resolve,
	sep,
} from "node:path";

const staticImportPattern =
	/\b(?:import\s*(?:[^"'()]*?\bfrom\s*)?|export\s*[^"'()]*?\bfrom\s*)["']([^"']+)["']/g;

function isInside(directory, filePath) {
	const relativePath = relative(directory, filePath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith(`..${sep}`) &&
			relativePath !== ".." &&
			!isAbsolute(relativePath))
	);
}

function relativeJavaScriptImports(source, importerPath, distDirectory) {
	const imports = [];
	for (const match of source.matchAll(staticImportPattern)) {
		const specifier = match[1];
		if (!specifier?.startsWith(".")) continue;

		const importedPath = resolve(
			dirname(importerPath),
			specifier.split(/[?#]/, 1)[0],
		);
		if (
			isInside(distDirectory, importedPath) &&
			[".js", ".mjs"].includes(extname(importedPath))
		) {
			imports.push(importedPath);
		}
	}
	return imports;
}

export function assertRootBundleNeutral(
	entryPath,
	distDirectory,
	prohibitedPackages,
) {
	const pending = [resolve(entryPath)];
	const visited = new Set();

	while (pending.length > 0) {
		const filePath = pending.pop();
		if (!filePath || visited.has(filePath)) continue;
		visited.add(filePath);

		const source = readFileSync(filePath, "utf8");
		for (const packageName of prohibitedPackages) {
			if (source.includes(packageName)) {
				const relativePath = relative(distDirectory, filePath)
					.split(sep)
					.join("/");
				throw new Error(
					`root bundle includes ${packageName} in ${relativePath}`,
				);
			}
		}

		pending.push(
			...relativeJavaScriptImports(source, filePath, distDirectory),
		);
	}
}
