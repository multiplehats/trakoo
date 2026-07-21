import { OpenPanelServerProvider } from "@/providers/openpanel/server.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructorSpy, sdk } = vi.hoisted(() => ({
	constructorSpy: vi.fn(),
	sdk: {
		identify: vi.fn(),
		track: vi.fn(),
		clear: vi.fn(),
	},
}));

vi.mock("@openpanel/sdk", () => ({
	OpenPanel: class {
		identify = sdk.identify;
		track = sdk.track;
		clear = sdk.clear;

		constructor(config: unknown) {
			constructorSpy(config);
		}
	},
}));

describe("OpenPanelServerProvider", () => {
	beforeEach(() => {
		constructorSpy.mockClear();
		for (const mock of Object.values(sdk)) mock.mockReset();
		sdk.track.mockResolvedValue(null);
		sdk.identify.mockResolvedValue(null);
	});

	it("initializes synchronously once with authenticated server options", () => {
		const filter = vi.fn(() => true);
		const provider = new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "client-secret",
			apiUrl: "https://openpanel.example.com",
			debug: true,
			filter,
		});

		provider.initialize();
		provider.initialize();

		expect(provider.name).toBe("OpenPanel-Server");
		expect(constructorSpy).toHaveBeenCalledTimes(1);
		expect(constructorSpy).toHaveBeenCalledWith({
			clientId: "client-id",
			clientSecret: "client-secret",
			apiUrl: "https://openpanel.example.com",
			debug: true,
			filter,
		});
	});

	it("validates both credentials and respects disabled mode", () => {
		expect(() =>
			new OpenPanelServerProvider({
				clientId: "",
				clientSecret: "secret",
			}).initialize(),
		).toThrow("clientId");
		expect(() =>
			new OpenPanelServerProvider({
				clientId: "client-id",
				clientSecret: "",
			}).initialize(),
		).toThrow("clientSecret");

		new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "secret",
			enabled: false,
		}).initialize();
		expect(constructorSpy).not.toHaveBeenCalled();
	});

	it("submits identify traits and clears retained identity before awaiting", async () => {
		let resolveIdentify: (() => void) | undefined;
		sdk.identify.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveIdentify = resolve;
			}),
		);
		const provider = new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "secret",
		});
		await provider.initialize();

		const pending = provider.identify("user-a", {
			firstName: "Jane",
			email: "jane@example.com",
			plan: "pro",
		});

		expect(sdk.identify).toHaveBeenCalledWith({
			profileId: "user-a",
			firstName: "Jane",
			email: "jane@example.com",
			properties: { plan: "pro" },
		});
		expect(sdk.clear).toHaveBeenCalledTimes(1);
		resolveIdentify?.();
		await pending;
	});

	it("never inherits an identified profile for later server events", async () => {
		const provider = new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "secret",
		});
		await provider.initialize();
		await provider.identify("user-a", { plan: "pro" });

		await provider.track({
			action: "anonymous_event",
			category: "engagement",
			properties: {},
		});
		await provider.track(
			{ action: "known_event", category: "engagement", properties: {} },
			{ user: { userId: "user-b" } },
		);

		expect(sdk.track).toHaveBeenNthCalledWith(1, "anonymous_event", {
			category: "engagement",
		});
		expect(sdk.track).toHaveBeenNthCalledWith(2, "known_event", {
			category: "engagement",
			profileId: "user-b",
		});
	});

	it("prefers event userId and maps full event context", async () => {
		const provider = new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "secret",
		});
		await provider.initialize();

		await provider.track(
			{
				action: "invoice_paid",
				category: "conversion",
				timestamp: 1_700_000_000_000,
				userId: "event-user",
				sessionId: "session-1",
				properties: { amount: 42 },
			},
			{
				page: {
					path: "/billing",
					title: "Billing",
					host: "example.com",
					protocol: "https",
					search: "?invoice=123",
				},
				device: { userAgent: "test-agent" },
				user: {
					userId: "context-user",
					email: "user@example.com",
					traits: { plan: "pro" },
				},
			},
		);

		expect(sdk.track).toHaveBeenCalledWith("invoice_paid", {
			amount: 42,
			category: "conversion",
			__timestamp: "2023-11-14T22:13:20.000Z",
			profileId: "event-user",
			sessionId: "session-1",
			__path: "/billing",
			__title: "Billing",
			page: {
				path: "/billing",
				title: "Billing",
				host: "example.com",
				protocol: "https",
				search: "?invoice=123",
			},
			device: { userAgent: "test-agent" },
			user_email: "user@example.com",
			user_traits: { plan: "pro" },
		});
	});

	it("tracks screen views without retaining identity and leaves pageLeave unsupported", async () => {
		const provider = new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "secret",
		});
		await provider.initialize();

		await provider.pageView(
			{ section: "docs" },
			{
				page: { path: "/docs", title: "Docs" },
				user: { userId: "user-1" },
			},
		);
		provider.pageLeave({ duration: 1000 });
		provider.reset();
		await provider.shutdown();

		expect(sdk.track).toHaveBeenCalledOnce();
		expect(sdk.track).toHaveBeenCalledWith("screen_view", {
			section: "docs",
			category: "navigation",
			profileId: "user-1",
			__path: "/docs",
			__title: "Docs",
			page: { path: "/docs", title: "Docs" },
		});
		expect(sdk.clear).toHaveBeenCalledTimes(2);
	});
});
