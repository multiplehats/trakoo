import { describe, it, expect } from "vitest";
import * as Analytics from "@/client/index";

describe("trakoo exports", () => {
	it("should export only the registry-bound client factory", () => {
		expect(Analytics.createClientAnalytics).toBeDefined();
		expect(Analytics).not.toHaveProperty("createAnalytics");
		expect(Analytics).not.toHaveProperty("getAnalytics");
		expect(Analytics).not.toHaveProperty("track");
		expect(Analytics).not.toHaveProperty("identify");
		expect(Analytics).not.toHaveProperty("pageView");
		expect(Analytics).not.toHaveProperty("pageLeave");
		expect(Analytics).not.toHaveProperty("reset");
		expect(Analytics).not.toHaveProperty("flush");
	});

	it("should export provider classes (client only)", () => {
		expect(Analytics.BaseAnalyticsProvider).toBeDefined();
		expect(Analytics.PostHogClientProvider).toBeDefined();
	});

	it("should export analytics classes", () => {
		expect(Analytics.BrowserAnalytics).toBeDefined();
	});
});
