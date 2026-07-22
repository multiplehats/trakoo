import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	ingestProxyEvents,
	createProxyHandler,
} from "@/providers/proxy/server.js";
import { createServerAnalytics } from "@/server.js";
import { MockAnalyticsProvider } from "./mock-provider.js";
import type { ProxyPayload } from "@/providers/proxy/types.js";
import { defineEvents, noProperties, typed } from "@/core/events/index.js";
import type { ServerAnalytics } from "@/adapters/server/server-analytics.js";

interface UserTraits {
	email?: string;
	plan?: "free" | "pro";
}

const proxyEvents = defineEvents({
	buttonClicked: {
		name: "button_clicked",
		category: "engagement",
		properties: typed<{ buttonId: string }>(),
	},
	event1: {
		name: "event1",
		category: "test",
		properties: typed<Record<string, unknown>>(),
	},
	event2: {
		name: "event2",
		category: "test",
		properties: typed<Record<string, unknown>>(),
	},
	testEvent: {
		name: "test_event",
		category: "test",
		properties: typed<Record<string, unknown>>(),
	},
	test: {
		name: "test",
		category: "test",
		properties: typed<Record<string, unknown>>(),
	},
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
	},
});

function assertStrictPublicServerTypes(
	analytics: ServerAnalytics<typeof proxyEvents, UserTraits>,
): void {
	analytics.identify("user-123", { plan: "pro" });
	analytics.track("button_clicked", { buttonId: "cta" });

	// @ts-expect-error raw traits do not widen the public identify API
	analytics.identify("user-123", { company: "Acme" });
	// @ts-expect-error raw event names do not widen the public track API
	analytics.track("unknown_event", {});
	// @ts-expect-error event properties remain strict at the public track API
	analytics.track("button_clicked", { label: "CTA" });
}

void assertStrictPublicServerTypes;

describe("Proxy Server Ingestion", () => {
	let serverAnalytics: ServerAnalytics<typeof proxyEvents, UserTraits>;
	let mockProvider: MockAnalyticsProvider;

	beforeEach(() => {
		mockProvider = new MockAnalyticsProvider();
		serverAnalytics = createServerAnalytics({
			events: proxyEvents,
			userTraits: typed<UserTraits>(),
			providers: [mockProvider],
		});
		serverAnalytics.initialize();
	});

	describe("ingestProxyEvents", () => {
		it("should process track events", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "button_clicked",
							category: "engagement",
							properties: { buttonId: "signup-cta" },
						},
						context: {
							page: {
								path: "/pricing",
							},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.track).toHaveLength(1);
			expect(mockProvider.calls.track[0].event.action).toBe("button_clicked");
			expect(mockProvider.calls.track[0].event.properties?.buttonId).toBe(
				"signup-cta",
			);
		});

		it("replays client-shaped propertyless tracks with server options", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "session_started",
							category: "user",
							properties: {},
							userId: "user-123",
							sessionId: "session-123",
						},
						context: { page: { path: "/start" } },
					},
				],
			};
			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.track[0]).toMatchObject({
				event: {
					action: "session_started",
					category: "user",
					properties: {},
					userId: "user-123",
					sessionId: "session-123",
				},
				context: { page: { path: "/start" } },
			});
		});

		it.each([
			["non-empty properties", { unexpected: true }],
			["null properties", null],
			["array properties", []],
			["primitive properties", "unexpected"],
		])(
			"validates propertyless proxy tracks with %s",
			async (_label, properties) => {
				const validationError = vi.fn();
				const replayError = vi.fn();
				const strictAnalytics = createServerAnalytics({
					events: proxyEvents,
					userTraits: typed<UserTraits>(),
					providers: [mockProvider],
					validation: { onFailure: "throw", onError: validationError },
				});
				const payload = {
					events: [
						{
							type: "track",
							event: {
								action: "session_started",
								category: "user",
								properties,
							},
						},
					],
				} as unknown as ProxyPayload;
				const request = new Request("http://localhost/api/events", {
					method: "POST",
					body: JSON.stringify(payload),
				});

				await ingestProxyEvents(request, strictAnalytics, {
					onError: replayError,
				});

				expect(validationError).toHaveBeenCalledWith(
					expect.objectContaining({ code: "invalid_properties" }),
				);
				expect(replayError).toHaveBeenCalledWith(
					expect.objectContaining({ code: "invalid_properties" }),
				);
				expect(mockProvider.calls.track).toHaveLength(0);
			},
		);

		it("should process identify events", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "identify",
						userId: "user-123",
						traits: {
							email: "user@example.com",
							plan: "pro",
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.identify).toHaveLength(1);
			expect(mockProvider.calls.identify[0].userId).toBe("user-123");
			expect(mockProvider.calls.identify[0].traits?.email).toBe(
				"user@example.com",
			);
		});

		it("replays raw identify traits and enriched typed user context", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "identify",
						userId: "user-123",
						traits: { email: "user@example.com", plan: "pro" },
					},
					{
						type: "track",
						event: {
							action: "test_event",
							category: "ignored-at-replay",
							properties: { source: "proxy" },
						},
						context: {
							user: {
								userId: "user-123",
								email: "user@example.com",
								traits: { plan: "pro" },
							},
						},
					},
				],
			};
			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: { "X-Forwarded-For": "1.2.3.4" },
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics, {
				enrichContext: () => ({ server: { requestId: "req-123" } }),
			});

			expect(mockProvider.calls.identify[0]).toEqual({
				userId: "user-123",
				traits: { email: "user@example.com", plan: "pro" },
			});
			expect(mockProvider.calls.track[0].context).toMatchObject({
				user: {
					userId: "user-123",
					email: "user@example.com",
					traits: { plan: "pro" },
				},
				server: { requestId: "req-123" },
				device: { ip: "1.2.3.4" },
			});
		});

		it("routes unknown raw track names through server validation policy", async () => {
			const validationError = vi.fn();
			const replayError = vi.fn();
			const strictAnalytics = createServerAnalytics({
				events: proxyEvents,
				userTraits: typed<UserTraits>(),
				providers: [mockProvider],
				validation: { onFailure: "throw", onError: validationError },
			});
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "not_registered",
							category: "raw",
							properties: { secret: true },
						},
					},
				],
			};
			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, strictAnalytics, {
				onError: replayError,
			});

			expect(validationError).toHaveBeenCalledWith(
				expect.objectContaining({ code: "unknown_event" }),
			);
			expect(replayError).toHaveBeenCalledWith(
				expect.objectContaining({ code: "unknown_event" }),
			);
			expect(mockProvider.calls.track).toHaveLength(0);
		});

		it("should process pageView events", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "pageView",
						properties: {
							experiment: "v2",
						},
						context: {
							page: {
								path: "/home",
							},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.pageView).toHaveLength(1);
			expect(mockProvider.calls.pageView[0].properties?.experiment).toBe("v2");
		});

		it("should process reset events (no-op on server)", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "reset",
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			// Reset is a client-side concept, so it's a no-op on server
			expect(mockProvider.calls.reset).toBe(0);
		});

		it("should process multiple events in batch", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "identify",
						userId: "user-123",
					},
					{
						type: "track",
						event: {
							action: "event1",
							category: "test",
							properties: {},
						},
					},
					{
						type: "pageView",
					},
					{
						type: "track",
						event: {
							action: "event2",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.identify).toHaveLength(1);
			expect(mockProvider.calls.track).toHaveLength(2);
			expect(mockProvider.calls.pageView).toHaveLength(1);
		});

		it("should extract IP from standard headers", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"X-Forwarded-For": "1.2.3.4, 5.6.7.8",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			// IP is now properly typed in device context
			expect(mockProvider.calls.track[0].context?.device?.ip).toBe("1.2.3.4");
		});

		it("should extract IP from X-Real-IP header", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"X-Real-IP": "9.8.7.6",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.track[0].context?.device?.ip).toBe("9.8.7.6");
		});

		it("should extract IP from Cloudflare header", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"CF-Connecting-IP": "1.1.1.1",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.track[0].context?.device?.ip).toBe("1.1.1.1");
		});

		it("should use custom IP extractor", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"X-Custom-IP": "10.0.0.1",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics, {
				extractIp: (req) => req.headers.get("x-custom-ip") || undefined,
			});

			expect(mockProvider.calls.track[0].context?.device?.ip).toBe("10.0.0.1");
		});

		it("should extract user-agent from request headers and add to server context", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			// User-agent is now properly typed in server context
			expect(mockProvider.calls.track[0].context?.server?.userAgent).toBe(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
			);
		});

		it("should enrich both IP and user-agent together", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"X-Forwarded-For": "192.168.1.1",
					"User-Agent": "Chrome/120.0",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			const context = mockProvider.calls.track[0].context;
			expect(context?.device?.ip).toBe("192.168.1.1");
			expect(context?.server?.userAgent).toBe("Chrome/120.0");
		});

		it("should enrich context with custom server data", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics, {
				enrichContext: (req) => ({
					server: {
						region: "us-east-1",
						version: "1.0.0",
						requestId: "req-123",
					},
					request: {
						method: req.method,
					},
				}),
			});

			const context = mockProvider.calls.track[0].context;
			// Server context is now properly typed
			expect(context?.server?.region).toBe("us-east-1");
			expect(context?.server?.version).toBe("1.0.0");
			expect(context?.server?.requestId).toBe("req-123");
		});

		it("should merge server context from enrichContext with userAgent", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"User-Agent": "Test/1.0",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics, {
				enrichContext: () => ({
					server: {
						region: "us-west-2",
						timestamp: 1234567890,
					},
				}),
			});

			const context = mockProvider.calls.track[0].context;
			// Both custom server fields and userAgent should be present
			expect(context?.server?.region).toBe("us-west-2");
			expect(context?.server?.timestamp).toBe(1234567890);
			expect(context?.server?.userAgent).toBe("Test/1.0");
		});

		it("should handle errors gracefully", async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify({ invalid: "payload" }),
			});

			await expect(
				ingestProxyEvents(request, serverAnalytics),
			).rejects.toThrow();

			expect(consoleError).toHaveBeenCalled();
			consoleError.mockRestore();
		});

		it("should call custom error handler", async () => {
			const onError = vi.fn();

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify({ invalid: "payload" }),
			});

			await expect(
				ingestProxyEvents(request, serverAnalytics, { onError }),
			).rejects.toThrow();

			expect(onError).toHaveBeenCalled();
		});

		it("should handle individual event errors without stopping batch", async () => {
			const onError = vi.fn();

			// Create a provider that throws on identify
			const errorProvider = new MockAnalyticsProvider();
			errorProvider.identify = () => {
				throw new Error("Identify failed");
			};

			const analytics = createServerAnalytics({
				events: proxyEvents,
				userTraits: typed<UserTraits>(),
				providers: [errorProvider],
			});
			analytics.initialize();

			const payload: ProxyPayload = {
				events: [
					{
						type: "identify",
						userId: "user-123",
					},
					{
						type: "track",
						event: {
							action: "test",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, analytics, { onError });

			// Error handler should be called for the failed identify
			expect(onError).toHaveBeenCalledWith(expect.any(Error));
			// But track should still succeed
			expect(errorProvider.calls.track).toHaveLength(1);
		});

		it("should handle unknown event types", async () => {
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});

			const payload = {
				events: [
					{
						type: "unknown_type",
						data: "something",
					},
				],
			} as unknown as ProxyPayload;

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(consoleWarn).toHaveBeenCalledWith(
				"[Proxy] Unknown event type:",
				expect.any(Object),
			);

			consoleWarn.mockRestore();
		});

		it("should preserve client-side context", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
						context: {
							page: {
								path: "/test",
								title: "Test Page",
							},
							device: {
								userAgent: "Mozilla/5.0",
								language: "en-US",
							},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			const context = mockProvider.calls.track[0].context;
			expect(context?.page?.path).toBe("/test");
			expect(context?.page?.title).toBe("Test Page");
			// Device context fields are now properly typed
			expect(context?.device?.userAgent).toBe("Mozilla/5.0");
			expect(context?.device?.language).toBe("en-US");
		});

		it("should work with pageView events and server enrichment", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "pageView",
						properties: {
							loadTime: 250,
						},
						context: {
							page: {
								path: "/products",
							},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				headers: {
					"X-Forwarded-For": "10.20.30.40",
					"User-Agent": "Safari/17.0",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			const context = mockProvider.calls.pageView[0].context;
			expect(context?.device?.ip).toBe("10.20.30.40");
			expect(context?.server?.userAgent).toBe("Safari/17.0");
			expect(context?.page?.path).toBe("/products");
		});
	});

	describe("createProxyHandler", () => {
		it("should create a working request handler", async () => {
			const handler = createProxyHandler(serverAnalytics);

			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test_event",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			const response = await handler(request);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("OK");
			expect(mockProvider.calls.track).toHaveLength(1);
		});

		it("should return 500 on error", async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const handler = createProxyHandler(serverAnalytics);

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: "invalid json",
			});

			const response = await handler(request);

			expect(response.status).toBe(500);
			expect(await response.text()).toBe("Internal Server Error");

			consoleError.mockRestore();
		});

		it("should pass through config options", async () => {
			const onError = vi.fn();
			const handler = createProxyHandler(serverAnalytics, { onError });

			const request = new Request("http://localhost/api/events", {
				method: "POST",
				body: "invalid json",
			});

			await handler(request);

			expect(onError).toHaveBeenCalled();
		});
	});

	describe("Serverless Compatibility", () => {
		it("should work with standard Request/Response interface", async () => {
			// This test verifies that we only use standard Web APIs
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test",
							category: "test",
							properties: {},
						},
					},
				],
			};

			// Standard Request (works in Vercel, Netlify, Cloudflare Workers, etc.)
			const request = new Request("https://example.com/api/events", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": "1.2.3.4",
				},
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.track).toHaveLength(1);
		});

		it("should work with headers as Headers object", async () => {
			const payload: ProxyPayload = {
				events: [
					{
						type: "track",
						event: {
							action: "test",
							category: "test",
							properties: {},
						},
					},
				],
			};

			const headers = new Headers();
			headers.set("Content-Type", "application/json");
			headers.set("X-Forwarded-For", "1.2.3.4");

			const request = new Request("https://example.com/api/events", {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			});

			await ingestProxyEvents(request, serverAnalytics);

			expect(mockProvider.calls.track[0].context?.device?.ip).toBe("1.2.3.4");
		});
	});
});
