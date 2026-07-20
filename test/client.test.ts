import { describe, it, expect } from "vitest";
import * as Analytics from "@/client/index";

describe("trakoo exports", () => {
	it("should export client analytics functions", () => {
		expect(Analytics.createClientAnalytics).toBeDefined();
		expect(Analytics.getAnalytics).toBeDefined();
		expect(Analytics.track).toBeDefined();
		expect(Analytics.identify).toBeDefined();
		expect(Analytics.pageView).toBeDefined();
		expect(Analytics.pageLeave).toBeDefined();
		expect(Analytics.reset).toBeDefined();
	});

	it("should export provider classes (client only)", () => {
		expect(Analytics.BaseAnalyticsProvider).toBeDefined();
		expect(Analytics.PostHogClientProvider).toBeDefined();
	});

	it("should export analytics classes", () => {
		expect(Analytics.BrowserAnalytics).toBeDefined();
	});
});
