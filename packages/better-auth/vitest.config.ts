import { defineConfig, mergeConfig } from "vitest/config";
import { adapterTestConfig } from "../vitest.shared.js";

export default mergeConfig(
	adapterTestConfig,
	defineConfig({
		test: {
			// Processed by Vite so tests can stand in for WebAuthn verification.
			server: { deps: { inline: ["@better-auth/passkey"] } },
		},
	}),
);
