/** @vitest-environment jsdom */
import { OpenPanelClientProvider } from "@/providers/openpanel/client.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { constructorSpy, sdk } = vi.hoisted(() => ({
	constructorSpy: vi.fn(),
	sdk: {
		identify: vi.fn(),
		track: vi.fn(),
		screenView: vi.fn(),
		clear: vi.fn(),
	},
}));

vi.mock("@openpanel/web", () => {
	class OpenPanelBase {
		track(name: string, properties?: Record<string, unknown>) {
			return sdk.track(name, properties);
		}
	}

	return {
		OpenPanelBase,
		OpenPanel: class extends OpenPanelBase {
			identify = sdk.identify;
			screenView = sdk.screenView;
			clear = sdk.clear;

			constructor(config: unknown) {
				super();
				constructorSpy(config);
			}
		},
	};
});

describe("OpenPanelClientProvider", () => {
	beforeEach(() => {
		constructorSpy.mockClear();
		for (const mock of Object.values(sdk)) mock.mockReset();
		sdk.track.mockResolvedValue(null);
		sdk.identify.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("initializes once with explicit auto-capture defaults", async () => {
		const provider = new OpenPanelClientProvider({ clientId: "client-id" });

		await Promise.all([provider.initialize(), provider.initialize()]);

		expect(provider.name).toBe("OpenPanel-Client");
		expect(constructorSpy).toHaveBeenCalledTimes(1);
		expect(constructorSpy).toHaveBeenCalledWith({
			clientId: "client-id",
			debug: false,
			trackAttributes: false,
			trackOutgoingLinks: false,
			trackScreenViews: false,
		});
	});

	it("forwards safe web options without provider-only fields", async () => {
		const filter = vi.fn(() => true);
		const provider = new OpenPanelClientProvider({
			clientId: "client-id",
			apiUrl: "https://openpanel.example.com",
			debug: true,
			enabled: true,
			filter,
			trackScreenViews: true,
			trackOutgoingLinks: true,
			trackAttributes: true,
		});

		await provider.initialize();

		expect(constructorSpy).toHaveBeenCalledWith({
			clientId: "client-id",
			apiUrl: "https://openpanel.example.com",
			debug: true,
			filter,
			trackAttributes: true,
			trackOutgoingLinks: true,
			trackScreenViews: true,
		});
	});

	it("strips server-only options supplied by untyped callers", async () => {
		const provider = new OpenPanelClientProvider({
			clientId: "client-id",
			clientSecret: "must-not-reach-browser-sdk",
			disabled: true,
			sdk: "custom",
			sdkVersion: "1.0.0",
			waitForProfile: true,
		} as unknown as ConstructorParameters<typeof OpenPanelClientProvider>[0]);

		await provider.initialize();

		expect(constructorSpy).toHaveBeenCalledWith({
			clientId: "client-id",
			debug: false,
			trackAttributes: false,
			trackOutgoingLinks: false,
			trackScreenViews: false,
		});
	});

	it("validates clientId and respects disabled mode", async () => {
		await expect(
			new OpenPanelClientProvider({ clientId: "" }).initialize(),
		).rejects.toThrow("clientId");

		await new OpenPanelClientProvider({
			clientId: "client-id",
			enabled: false,
		}).initialize();

		expect(constructorSpy).not.toHaveBeenCalled();
	});

	it("maps identify traits to OpenPanel profile fields and properties", async () => {
		const provider = new OpenPanelClientProvider({ clientId: "client-id" });
		await provider.initialize();

		await provider.identify("user-1", {
			firstName: "Jane",
			lastName: "Doe",
			email: "jane@example.com",
			avatar: "https://example.com/jane.png",
			phone: "+31612345678",
			plan: "pro",
		});

		expect(sdk.identify).toHaveBeenCalledWith({
			profileId: "user-1",
			firstName: "Jane",
			lastName: "Doe",
			email: "jane@example.com",
			avatar: "https://example.com/jane.png",
			properties: { phone: "+31612345678", plan: "pro" },
		});
	});

	it("delivers identify and pageView calls made during initialization", async () => {
		const provider = new OpenPanelClientProvider({ clientId: "client-id" });

		const initializing = provider.initialize();
		provider.identify("user-early", { email: "early@example.com" });
		provider.pageView(
			{ section: "early" },
			{ page: { path: "/early", title: "Early" } },
		);
		await initializing;
		await vi.waitFor(() => {
			expect(sdk.identify).toHaveBeenCalledOnce();
			expect(sdk.screenView).toHaveBeenCalledOnce();
		});

		expect(sdk.identify).toHaveBeenCalledWith({
			profileId: "user-early",
			email: "early@example.com",
		});
		expect(sdk.screenView).toHaveBeenCalledWith("/early", {
			section: "early",
			__path: "/early",
			__title: "Early",
			page: { path: "/early", title: "Early" },
		});
	});

	it("tracks events with OpenPanel and Trakoo context", async () => {
		const provider = new OpenPanelClientProvider({ clientId: "client-id" });
		await provider.initialize();

		await provider.track(
			{
				action: "checkout_started",
				category: "conversion",
				timestamp: 1_700_000_000_000,
				userId: "user-1",
				sessionId: "session-1",
				properties: { amount: 42 },
			},
			{
				page: {
					path: "/checkout",
					title: "Checkout",
					referrer: "https://example.com/cart",
					host: "example.com",
					protocol: "https",
					search: "?coupon=summer",
				},
				device: { type: "desktop", browser: "Firefox" },
				utm: { source: "newsletter" },
				user: { email: "jane@example.com", traits: { plan: "pro" } },
			},
		);

		expect(sdk.track).toHaveBeenCalledWith("checkout_started", {
			amount: 42,
			category: "conversion",
			__timestamp: "2023-11-14T22:13:20.000Z",
			profileId: "user-1",
			sessionId: "session-1",
			__path: "/checkout",
			__title: "Checkout",
			__referrer: "https://example.com/cart",
			page: {
				path: "/checkout",
				title: "Checkout",
				referrer: "https://example.com/cart",
				host: "example.com",
				protocol: "https",
				search: "?coupon=summer",
			},
			device: { type: "desktop", browser: "Firefox" },
			utm: { source: "newsletter" },
			user_email: "jane@example.com",
			user_traits: { plan: "pro" },
		});
	});

	it("maps page views, leaves pageLeave unsupported, and clears identity", async () => {
		const provider = new OpenPanelClientProvider({ clientId: "client-id" });
		await provider.initialize();

		provider.pageView(
			{ section: "docs" },
			{ page: { path: "/docs", title: "Docs" } },
		);
		provider.pageLeave({ duration: 1000 });
		provider.reset();

		expect(sdk.screenView).toHaveBeenCalledWith("/docs", {
			section: "docs",
			__path: "/docs",
			__title: "Docs",
			page: { path: "/docs", title: "Docs" },
		});
		expect(sdk.track).not.toHaveBeenCalled();
		expect(sdk.clear).toHaveBeenCalledTimes(1);
	});
});
