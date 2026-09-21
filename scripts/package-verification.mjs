import { existsSync, readFileSync, readdirSync } from "node:fs";
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

/**
 * Every relative type import in the packed declarations must resolve to a file
 * that was actually emitted.
 *
 * `vite build` exits 0 when the declaration plugin rejects a source file, so a
 * module that fails `isolatedDeclarations` is silently dropped from `dist`
 * while the importers that reference it are still published. Consumers then
 * see `any` where a real type should be, and only at their own type-check.
 */
export function assertDeclarationImportsResolve(distDirectory) {
	for (const declarationPath of declarationFiles(distDirectory)) {
		const source = readFileSync(declarationPath, "utf8");
		for (const match of source.matchAll(staticImportPattern)) {
			const specifier = match[1];
			if (!specifier?.startsWith(".")) continue;

			const importedPath = resolve(
				dirname(declarationPath),
				specifier.split(/[?#]/, 1)[0],
			);
			if (!isInside(distDirectory, importedPath)) continue;

			const declaration = importedPath.replace(/\.js$/, ".d.ts");
			if (!existsSync(declaration)) {
				throw new Error(
					`${relative(distDirectory, declarationPath)} imports ${specifier}, but ${relative(distDirectory, declaration)} was not emitted`,
				);
			}
		}
	}
}

function declarationFiles(directory) {
	const found = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = resolve(directory, entry.name);
		if (entry.isDirectory()) found.push(...declarationFiles(entryPath));
		else if (entry.name.endsWith(".d.ts")) found.push(entryPath);
	}
	return found;
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

		pending.push(...relativeJavaScriptImports(source, filePath, distDirectory));
	}
}
