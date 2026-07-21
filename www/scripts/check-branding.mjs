import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const vercel = JSON.parse(read("www/vercel.json"));
assert.deepEqual(vercel.redirects, [
	{
		destination: "/docs",
		permanent: false,
		source: "/",
	},
]);

const config = read("www/blume.config.ts");
assert.match(config, /title:\s*"trakoo"/);
assert.match(config, /logo:\s*\{/);
assert.match(config, /light:\s*"\/trakoo-logo\.png"/);
assert.match(config, /dark:\s*"\/trakoo-logo\.png"/);
assert.match(config, /alt:\s*"trakoo"/);
assert.match(config, /site:\s*"https:\/\/stacksee-analytics\.vercel\.app"/);
assert.match(config, /og:\s*\{\s*enabled:\s*true/s);

const readme = read("README.md");
assert.match(readme, /^<p align="center">\s*<img src="\.\/\.github\/assets\/trakoo-logo\.png"/s);

const homepage = read("www/content/docs/(Getting Started)/index.mdx");
assert.match(homepage, /seo:\s*\n\s+image:\s*\/opengraph-docs\.png/);

for (const asset of [
	".github/assets/trakoo-logo.png",
	".github/social-preview.png",
	"www/public/trakoo-logo.png",
	"www/public/opengraph-docs.png",
]) {
	assert.ok(existsSync(resolve(root, asset)), `Missing ${asset}`);
}

console.log("Branding and homepage configuration verified.");
