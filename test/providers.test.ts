import { describe, it, expect } from "vitest";
import * as ClientProviders from "@/providers/client";
import * as ServerProviders from "@/providers/server";

// SDK-backed providers ship as @trakoo/* packages so their peer ranges never
// reach users of other providers.
const sdkBackedProviders = [
	"PostHogClientProvider",
	"PostHogServerProvider",
	"OpenPanelClientProvider",
	"OpenPanelServerProvider",
	"BentoServerProvider",
	"EmitKitServerProvider",
];

describe("trakoo/providers exports", () => {
	it("should export only client-safe providers from client entry", () => {
		expect(ClientProviders.BaseAnalyticsProvider).toBeDefined();
		expect(ClientProviders.BentoClientProvider).toBeDefined();
		expect(ClientProviders.PirschClientProvider).toBeDefined();
		expect(ClientProviders.VisitorsClientProvider).toBeDefined();
		expect(ClientProviders.ProxyProvider).toBeDefined();
		expect(
			(ClientProviders as Record<string, unknown>).PirschServerProvider,
		).toBeUndefined();
	});

	it("should export only server providers from server entry", () => {
		expect(ServerProviders.BaseAnalyticsProvider).toBeDefined();
		expect(ServerProviders.PirschServerProvider).toBeDefined();
		expect(ServerProviders.ingestProxyEvents).toBeDefined();
		expect(
			(ServerProviders as Record<string, unknown>).PirschClientProvider,
		).toBeUndefined();
	});

	it.each(sdkBackedProviders)("does not export %s from core", (name) => {
		expect(ClientProviders).not.toHaveProperty(name);
		expect(ServerProviders).not.toHaveProperty(name);
	});
});
