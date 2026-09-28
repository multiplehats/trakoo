import { EmitKitServerProvider } from "../src/server.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sdk } = vi.hoisted(() => ({
	sdk: { construct: vi.fn(), identify: vi.fn(), createEvent: vi.fn() },
}));

vi.mock("@emitkit/js", () => ({
	EmitKit: class {
		identify = sdk.identify;
		events = { create: sdk.createEvent };
		constructor(...args: unknown[]) {
			sdk.construct(...args);
		}
	},
}));

describe("EmitKitServerProvider", () => {
	beforeEach(() => {
		for (const mock of Object.values(sdk)) mock.mockReset();
		sdk.identify.mockResolvedValue({
			id: "identity-1",
			userId: "user-a",
			properties: {},
			aliases: { created: [] },
			updatedAt: "2026-09-28T00:00:00.000Z",
		});
		sdk.createEvent.mockResolvedValue({ id: "event-1" });
	});

	it("gives each request the documented 5 second timeout", async () => {
		await new EmitKitServerProvider({ apiKey: "emitkit_key" }).initialize();
		await new EmitKitServerProvider({
			apiKey: "emitkit_key",
			timeout: 2000,
		}).initialize();

		expect(sdk.construct.mock.calls).toEqual([
			[{ apiKey: "emitkit_key", timeout: 5000 }],
			[{ apiKey: "emitkit_key", timeout: 2000 }],
		]);
	});

	it("uses only identity supplied on each server call", async () => {
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await provider.identify("user-a", { email: "user-a@example.com" });
		expect(sdk.identify).toHaveBeenCalledWith({
			userId: "user-a",
			properties: { email: "user-a@example.com" },
			aliases: ["user-a", "user-a@example.com"],
		});

		await provider.track({
			action: "anonymous_event",
			category: "engagement",
			properties: {},
		});
		expect(sdk.createEvent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ userId: null }),
		);

		await provider.track(
			{ action: "current_context", category: "engagement", properties: {} },
			{ user: { email: "user-b@example.com" } },
		);
		await provider.track({
			action: "event_identity",
			category: "engagement",
			userId: "event-user",
			properties: {},
		});
		expect(sdk.createEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ userId: "user-b@example.com" }),
		);
		expect(sdk.createEvent).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ userId: "event-user" }),
		);

		await provider.pageView();
		expect(sdk.createEvent).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({ userId: null }),
		);

		await provider.reset();
		await provider.track({
			action: "still_anonymous",
			category: "engagement",
			properties: {},
		});
		expect(sdk.createEvent).toHaveBeenNthCalledWith(
			5,
			expect.objectContaining({ userId: null }),
		);
	});
});
