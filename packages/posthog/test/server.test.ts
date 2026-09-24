import { PostHogServerProvider } from "../src/server.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructorSpy, sdk } = vi.hoisted(() => ({
	constructorSpy: vi.fn(),
	sdk: {
		capture: vi.fn(),
		identify: vi.fn(),
		flush: vi.fn(),
		shutdown: vi.fn(),
	},
}));

vi.mock("posthog-node", () => ({
	PostHog: class {
		capture = sdk.capture;
		identify = sdk.identify;
		flush = sdk.flush;
		shutdown = sdk.shutdown;

		constructor(key: string, options: unknown) {
			constructorSpy(key, options);
		}
	},
}));

describe("PostHogServerProvider", () => {
	beforeEach(() => {
		constructorSpy.mockReset();
		for (const mock of Object.values(sdk)) mock.mockReset();
		sdk.flush.mockResolvedValue(undefined);
		sdk.shutdown.mockResolvedValue(undefined);
	});

	it("initializes once and preserves track identity and properties", async () => {
		const provider = new PostHogServerProvider({
			apiKey: "project-key",
			host: "https://posthog.example.com",
			flushAt: 10,
		});

		await provider.initialize();
		await provider.initialize();
		provider.track(
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
					referrer: "/account",
				},
				device: { type: "desktop" },
				utm: { source: "newsletter" },
				user: {
					userId: "context-user",
					email: "user@example.com",
					traits: { plan: "pro" },
				},
			},
		);

		expect(constructorSpy).toHaveBeenCalledOnce();
		expect(constructorSpy).toHaveBeenCalledWith("project-key", {
			host: "https://posthog.example.com",
			flushAt: 10,
			flushInterval: 10000,
		});
		expect(sdk.capture).toHaveBeenCalledWith({
			distinctId: "event-user",
			event: "invoice_paid",
			properties: {
				amount: 42,
				category: "conversion",
				timestamp: new Date(1_700_000_000_000),
				sessionId: "session-1",
				$current_url: "/billing",
				$page_title: "Billing",
				$referrer: "/account",
				device: { type: "desktop" },
				utm: { source: "newsletter" },
				user_email: "user@example.com",
				user_traits: { plan: "pro" },
			},
		});
	});

	it("attributes page views to the current user ID before email", async () => {
		const provider = new PostHogServerProvider({ apiKey: "project-key" });
		await provider.initialize();

		provider.pageView(
			{ section: "docs", depth: 2 },
			{
				page: {
					path: "/docs/providers/posthog",
					title: "PostHog",
					referrer: "/docs/providers",
				},
				user: {
					userId: "user-123",
					email: "user@example.com",
				},
			},
		);

		expect(sdk.capture).toHaveBeenCalledWith({
			distinctId: "user-123",
			event: "$pageview",
			properties: {
				section: "docs",
				depth: 2,
				path: "/docs/providers/posthog",
				title: "PostHog",
				referrer: "/docs/providers",
			},
		});
	});

	it("uses current-call email when a page view has no user ID", async () => {
		const provider = new PostHogServerProvider({ apiKey: "project-key" });
		await provider.initialize();

		provider.pageView(
			{ section: "pricing" },
			{ user: { email: "visitor@example.com" } },
		);

		expect(sdk.capture).toHaveBeenCalledWith({
			distinctId: "visitor@example.com",
			event: "$pageview",
			properties: { section: "pricing" },
		});
	});

	it("keeps page views anonymous when current context has no identity", async () => {
		const provider = new PostHogServerProvider({ apiKey: "project-key" });
		await provider.initialize();

		provider.pageView({ section: "home" });

		expect(sdk.capture).toHaveBeenCalledWith({
			distinctId: "anonymous",
			event: "$pageview",
			properties: { section: "home" },
		});
	});

	it("does not retain identify identity for a later anonymous page view", async () => {
		const provider = new PostHogServerProvider({ apiKey: "project-key" });
		await provider.initialize();

		provider.identify("old-user", { plan: "pro" });
		provider.pageView({ section: "home" });

		expect(sdk.identify).toHaveBeenCalledWith({
			distinctId: "old-user",
			properties: { plan: "pro" },
		});
		expect(sdk.capture).toHaveBeenCalledWith({
			distinctId: "anonymous",
			event: "$pageview",
			properties: { section: "home" },
		});
	});

	it("keeps configuration, identity, properties, and context out of debug logs", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const provider = new PostHogServerProvider({
			apiKey: "DO_NOT_LOG_API_KEY",
			host: "https://DO_NOT_LOG_ENDPOINT.example",
			debug: true,
		});

		await provider.initialize();
		provider.identify("DO_NOT_LOG_USER_ID", {
			email: "DO_NOT_LOG_EMAIL",
		});
		provider.track(
			{
				action: "safe_registry_event",
				category: "engagement",
				properties: { value: "DO_NOT_LOG_PROPERTY" },
			},
			{
				page: { path: "/DO_NOT_LOG_CONTEXT" },
				user: { email: "DO_NOT_LOG_CONTEXT_EMAIL" },
			},
		);
		provider.pageView(
			{ value: "DO_NOT_LOG_PAGE_PROPERTY" },
			{ page: { path: "/DO_NOT_LOG_PAGE_CONTEXT" } },
		);

		const output = JSON.stringify(consoleSpy.mock.calls);
		expect(output).toContain("[PostHog-Server] Initialized successfully");
		expect(output).not.toContain("DO_NOT_LOG");
		expect(consoleSpy.mock.calls.every((call) => call.length === 1)).toBe(true);
		consoleSpy.mockRestore();
	});

	it("logs neither external error messages nor hostile error names", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const externalError = new Error("DO_NOT_LOG_EXTERNAL_ERROR_MESSAGE");
		externalError.name = "DO_NOT_LOG_HOSTILE_ERROR_NAME";
		constructorSpy.mockImplementationOnce(() => {
			throw externalError;
		});
		const provider = new PostHogServerProvider({
			apiKey: "DO_NOT_LOG_API_KEY",
		});

		await expect(provider.initialize()).rejects.toBe(externalError);

		const output = JSON.stringify(consoleSpy.mock.calls);
		expect(output).not.toContain("DO_NOT_LOG");
		expect(consoleSpy.mock.calls[0]).toHaveLength(1);
		consoleSpy.mockRestore();
	});

	it("coalesces concurrent initialization and retries after a rejected initializer", async () => {
		const initializationError = new Error("first initialization failed");
		constructorSpy.mockImplementationOnce(() => {
			throw initializationError;
		});
		const provider = new PostHogServerProvider({ apiKey: "project-key" });

		const first = provider.initialize();
		const concurrent = provider.initialize();

		expect(first).toBe(concurrent);
		await expect(first).rejects.toBe(initializationError);
		await expect(provider.initialize()).resolves.toBeUndefined();
		expect(constructorSpy).toHaveBeenCalledTimes(2);
	});
});
