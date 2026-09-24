import { fileURLToPath } from "node:url";
import type { UserConfig } from "vitest/config";

const coreSource = fileURLToPath(new URL("../src/", import.meta.url));

// Adapter tests run against core source so they need no core build first.
export const adapterTestConfig: UserConfig = {
	resolve: {
		alias: [
			{ find: /^trakoo$/, replacement: `${coreSource}index.ts` },
			{ find: /^@\//, replacement: coreSource },
		],
	},
	test: {
		globals: true,
		include: ["test/*.test.ts"],
	},
};
