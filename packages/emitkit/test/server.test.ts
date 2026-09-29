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

	it("gives each request the documented 5 second timeout without retries", async () => {
		await new EmitKitServerProvider({ apiKey: "emitkit_key" }).initialize();
		await new EmitKitServerProvider({
			apiKey: "emitkit_key",
			timeout: 2000,
		}).initialize();

		expect(sdk.construct.mock.calls).toEqual([
			[{ apiKey: "emitkit_key", timeout: 5000, maxRetries: 0 }],
			[{ apiKey: "emitkit_key", timeout: 2000, maxRetries: 0 }],
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
	it("lets an event's __emitkit_notify override the provider's notify", async () => {
		const provider = new EmitKitServerProvider({
			apiKey: "emitkit_key",
			notify: false,
		});
		await provider.initialize();

		await provider.track({
			action: "user_signed_up",
			category: "user",
			properties: { method: "email", __emitkit_notify: true },
		});
		await provider.track({
			action: "user_signed_in",
			category: "user",
			properties: { method: "email" },
		});

		expect(sdk.createEvent.mock.calls[0][0]).toMatchObject({ notify: true });
		expect(sdk.createEvent.mock.calls[1][0]).toMatchObject({ notify: false });
	});

	it("silences a single event when the provider notifies by default", async () => {
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await provider.track({
			action: "user_signed_in",
			category: "user",
			properties: { __emitkit_notify: false },
		});
		await provider.track({
			action: "user_signed_up",
			category: "user",
			properties: {},
		});

		expect(sdk.createEvent.mock.calls[0][0]).toMatchObject({ notify: false });
		expect(sdk.createEvent.mock.calls[1][0]).toMatchObject({ notify: true });
	});

	it("ignores a notify hint that is not a boolean", async () => {
		const provider = new EmitKitServerProvider({
			apiKey: "emitkit_key",
			notify: false,
		});
		await provider.initialize();

		await provider.track({
			action: "user_signed_up",
			category: "user",
			properties: { __emitkit_notify: "true" },
		});

		expect(sdk.createEvent.mock.calls[0][0]).toMatchObject({ notify: false });
	});

	it("keeps the __emitkit_* hints out of event and page view metadata", async () => {
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await provider.track({
			action: "user_signed_up",
			category: "user",
			properties: {
				method: "email",
				__emitkit_channel: "auth",
				__emitkit_notify: true,
			},
		});
		await provider.pageView({ __emitkit_notify: true, section: "docs" });

		const [event, pageView] = sdk.createEvent.mock.calls.map(([body]) => body);
		expect(event.channelName).toBe("auth");
		expect(event.metadata).not.toHaveProperty("__emitkit_channel");
		expect(event.metadata).not.toHaveProperty("__emitkit_notify");
		expect(event.metadata).toMatchObject({ method: "email" });
		expect(pageView.notify).toBe(true);
		expect(pageView.metadata).not.toHaveProperty("__emitkit_notify");
		expect(pageView.metadata).toMatchObject({ section: "docs" });
	});
});
