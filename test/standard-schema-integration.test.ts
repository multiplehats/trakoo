import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
	defineEvents,
	type EventInputMap,
	type EventOutputMap,
} from "@/index";
import { createServerAnalytics } from "@/server/index";
import { MockAnalyticsProvider } from "./mock-provider";

const events = defineEvents({
	purchaseCompleted: {
		name: "purchase_completed",
		category: "conversion",
		properties: z.object({
			orderId: z.string(),
			amount: z.string().transform(Number),
		}),
	},
});

describe("Standard Schema integration", () => {
	it("infers Zod input and output types directly", () => {
		expectTypeOf<
			EventInputMap<typeof events>["purchase_completed"]
		>().toEqualTypeOf<{ orderId: string; amount: string }>();
		expectTypeOf<
			EventOutputMap<typeof events>["purchase_completed"]
		>().toEqualTypeOf<{ orderId: string; amount: number }>();
	});

	it("delivers transformed Zod output to the provider", async () => {
		const provider = new MockAnalyticsProvider({ enabled: true });
		const analytics = createServerAnalytics({
			events,
			providers: [provider],
			validation: { onFailure: "throw" },
		});

		await analytics.track("purchase_completed", {
			orderId: "order_1",
			amount: "49",
		});

		expect(provider.calls.track[0].event.properties).toEqual({
			orderId: "order_1",
			amount: 49,
		});
	});
});
