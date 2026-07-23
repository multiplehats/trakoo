import { describe, expect, expectTypeOf, it } from "vitest";
import type { ServerAnalytics as ServerAnalyticsClass } from "@/adapters/server/server-analytics";
import * as ServerAnalytics from "@/server/index";
// @ts-expect-error applyValidationFailurePolicy is internal
import { applyValidationFailurePolicy } from "@/server/index";

void applyValidationFailurePolicy;

const { defineEvents, noProperties, typed } = ServerAnalytics;

interface UserTraits {
	plan: "free" | "pro";
}

const events = defineEvents({
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
	},
});

function assertServerFactoryTypes(): void {
	const analytics = ServerAnalytics.createServerAnalytics({
		events,
		userTraits: typed<UserTraits>(),
	});

	expectTypeOf(analytics).toEqualTypeOf<
		ServerAnalyticsClass<typeof events, UserTraits>
	>();

	// @ts-expect-error events is required
	ServerAnalytics.createServerAnalytics({});
}

void assertServerFactoryTypes;

describe("trakoo/server exports", () => {
	it("should export server analytics functions", () => {
		expect(ServerAnalytics.createServerAnalytics).toBeDefined();
		expect(ServerAnalytics.ServerAnalytics).toBeDefined();
	});

	it("exports the registry helpers and public validation error", () => {
		expect(ServerAnalytics.defineEvents).toBeDefined();
		expect(ServerAnalytics.typed).toBeDefined();
		expect(ServerAnalytics.noProperties).toBeDefined();
		expect(ServerAnalytics.AnalyticsValidationError).toBeDefined();
		expect(ServerAnalytics).not.toHaveProperty(
			"applyValidationFailurePolicy",
		);
	});
});
