import { describe, it, expect } from "vitest";
import * as ClientProviders from "@/providers/client";
import * as ServerProviders from "@/providers/server";

describe("trackle/providers exports", () => {
	it("should export only client-safe providers from client entry", () => {
		expect(ClientProviders.BaseAnalyticsProvider).toBeDefined();
		expect(ClientProviders.PostHogClientProvider).toBeDefined();
		expect(ClientProviders.VisitorsClientProvider).toBeDefined();
		expect(
			(ClientProviders as Record<string, unknown>).PostHogServerProvider,
		).toBeUndefined();
	});

	it("should export only server providers from server entry", () => {
		expect(ServerProviders.BaseAnalyticsProvider).toBeDefined();
		expect(ServerProviders.PostHogServerProvider).toBeDefined();
		expect(
			(ServerProviders as Record<string, unknown>).PostHogClientProvider,
		).toBeUndefined();
	});
});
