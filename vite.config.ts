import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	return {
		cacheDir: "node_modules/.vite",
		build: {
			lib: {
				entry: {
					index: resolve(__dirname, "src/index.ts"),
					client: resolve(__dirname, "src/client/index.ts"),
					server: resolve(__dirname, "src/server/index.ts"),
					"providers/client": resolve(__dirname, "src/providers/client.ts"),
					"providers/server": resolve(__dirname, "src/providers/server.ts"),
				},
				formats: ["es"],
			},
			rollupOptions: {
				external: [
					"@openpanel/sdk",
					"@openpanel/web",
					"posthog-node",
					"posthog-js",
				],
			},
			ssr: false,
		},
		resolve: {
			alias: {
				"@": resolve("src/"),
			},
		},
		test: {
			globals: true,
			include: ["test/*.test.ts"],
		},
		plugins: [
			// generate typescript types
			dts({
				insertTypesEntry: true,
				copyDtsFiles: false,
				exclude: ["test/**/*", "**/*.test.ts"],
				include: ["src/**/*"],
				entryRoot: "src",
				outDir: "dist",
				compilerOptions: {
					removeComments: false,
					declaration: true,
					emitDeclarationOnly: true,
				},
			}),
		],
		define: {
			"import.meta.vitest": mode !== "production",
		},
	};
});
