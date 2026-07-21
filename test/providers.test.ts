import { describe, it, expect } from "vitest";
import * as ClientProviders from "@/providers/client";
import * as ServerProviders from "@/providers/server";

describe("trakoo/providers exports", () => {
	it("should export only client-safe providers from client entry", () => {
		expect(ClientProviders.BaseAnalyticsProvider).toBeDefined();
		expect(ClientProviders.PostHogClientProvider).toBeDefined();
		expect(ClientProviders.OpenPanelClientProvider).toBeDefined();
		expect(ClientProviders.VisitorsClientProvider).toBeDefined();
		expect(
			(ClientProviders as Record<string, unknown>).PostHogServerProvider,
		).toBeUndefined();
		expect(
			(ClientProviders as Record<string, unknown>).OpenPanelServerProvider,
		).toBeUndefined();
	});

	it("should export only server providers from server entry", () => {
		expect(ServerProviders.BaseAnalyticsProvider).toBeDefined();
		expect(ServerProviders.PostHogServerProvider).toBeDefined();
		expect(ServerProviders.OpenPanelServerProvider).toBeDefined();
		expect(
			(ServerProviders as Record<string, unknown>).PostHogClientProvider,
		).toBeUndefined();
		expect(
			(ServerProviders as Record<string, unknown>).OpenPanelClientProvider,
		).toBeUndefined();
	});
});
