import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ServerAnalytics } from "@/adapters/server/server-analytics.js";
import { defineEvents, noProperties, typed } from "@/core/events/index.js";
import {
	createProxyHandler,
	ingestProxyEvents,
} from "@/providers/proxy/server.js";
import type { ProxyEventV2, ProxyPayloadV2 } from "@/providers/proxy/types.js";
import { createServerAnalytics } from "@/server.js";
import { MockAnalyticsProvider } from "./mock-provider.js";

interface UserTraits {
	email?: string;
	plan?: "free" | "pro";
	role?: string;
}

const proxyEvents = defineEvents({
	buttonClicked: {
		name: "button_clicked",
		category: "engagement",
		properties: typed<{ buttonId: string }>(),
	},
	strictEvent: {
		name: "strict_event",
		category: "test",
		properties: z.object({ count: z.number() }),
	},
	purchaseCompleted: {
		name: "purchase_completed",
		category: "conversion",
		properties: z.object({
			orderId: z.string(),
			amount: z.string().transform(Number),
		}),
	},
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
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
});

function assertStrictPublicServerTypes(
	analytics: ServerAnalytics<typeof proxyEvents, UserTraits>,
): void {
	analytics.identify("user-123", { plan: "pro" });
	analytics.track("button_clicked", { buttonId: "cta" });

	// @ts-expect-error raw traits do not widen the public identify API
	analytics.identify("user-123", { company: "Acme" });
	// @ts-expect-error runtime proxy names do not widen the public track API
	analytics.track("unknown_event", {});
	// @ts-expect-error event properties remain strict at the public track API
	analytics.track("button_clicked", { label: "CTA" });
}

void assertStrictPublicServerTypes;

function payload(events: ProxyEventV2[]): ProxyPayloadV2 {
	return { version: 2, events };
}

function requestFor(body: unknown, headers?: Record<string, string>): Request {
	const requestHeaders = new Headers({ "Content-Type": "application/json" });
	for (const [name, value] of Object.entries(headers ?? {})) {
		requestHeaders.set(name, value);
	}

	return new Request("http://localhost/api/events", {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

function rawRequest(
	body: string,
	options: {
		method?: string;
		headers?: Record<string, string>;
	} = {},
): Request {
	return new Request("http://localhost/api/events", {
		method: options.method ?? "POST",
		headers: options.headers,
		...(options.method === "GET" ? {} : { body }),
	});
}

function expectNoProviderDispatch(provider: MockAnalyticsProvider): void {
	expect(provider.calls.identify).toHaveLength(0);
	expect(provider.calls.track).toHaveLength(0);
	expect(provider.calls.pageView).toHaveLength(0);
	expect(provider.calls.pageLeave).toHaveLength(0);
	expect(provider.calls.reset).toBe(0);
}

async function expectErrorResponse(
	response: Response,
	status: number,
	code: string,
): Promise<void> {
	expect(response.status).toBe(status);
	expect(response.headers.get("content-type")).toContain("application/json");
	expect(await response.text()).toBe(JSON.stringify({ ok: false, code }));
}

describe("Proxy Server Ingestion", () => {
	let serverAnalytics: ServerAnalytics<typeof proxyEvents, UserTraits>;
	let mockProvider: MockAnalyticsProvider;

	beforeEach(async () => {
		mockProvider = new MockAnalyticsProvider();
		serverAnalytics = createServerAnalytics({
			events: proxyEvents,
			userTraits: typed<UserTraits>(),
			providers: [mockProvider],
		});
		await serverAnalytics.initialize();
	});

	describe("V2 envelope", () => {
		it.each([
			["missing version", { events: [] }],
			["version 1", { version: 1, events: [] }],
			["missing events", { version: 2 }],
			["non-array events", { version: 2, events: {} }],
		])("rejects %s with a typed payload-free error", async (_label, body) => {
			const onError = vi.fn();

			await expect(
				ingestProxyEvents(requestFor(body), serverAnalytics, { onError }),
			).rejects.toMatchObject({
				name: "ProxyTrustError",
				code: "invalid_payload",
				message: "Proxy request rejected: invalid_payload",
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "ProxyTrustError",
					code: "invalid_payload",
					message: "Proxy request rejected: invalid_payload",
				}),
			);
			expect(JSON.stringify(onError.mock.calls)).not.toContain(
				JSON.stringify(body),
			);
		});

		it("rejects malformed event structures before dispatch", async () => {
			const onError = vi.fn();
			const body = {
				version: 2,
				events: [
					{
						type: "track",
						name: 42,
						inputProvided: true,
						input: { count: 1 },
						occurredAt: Date.now(),
					},
				],
			};

			await expect(
				ingestProxyEvents(requestFor(body), serverAnalytics, { onError }),
			).rejects.toMatchObject({
				name: "ProxyTrustError",
				code: "invalid_payload",
			});
			expect(mockProvider.calls.track).toHaveLength(0);
		});

		it.each([
			["page path", { page: { path: 42 } }],
			["page title", { page: { path: "/", title: 42 } }],
			["UTM source", { utm: { source: 42 } }],
			["device language", { device: { language: 42 } }],
			["screen width", { device: { screen: { width: "wide" } } }],
			["viewport height", { device: { viewport: { height: "tall" } } }],
		])(
			"rejects malformed known client context field %s",
			async (_label, context) => {
				const onError = vi.fn();
				const body = {
					version: 2,
					events: [
						{
							type: "track",
							name: "event1",
							inputProvided: true,
							input: {},
							occurredAt: 1_725_000_000_000,
							context,
						},
					],
				};

				await expect(
					ingestProxyEvents(requestFor(body), serverAnalytics, { onError }),
				).rejects.toMatchObject({
					name: "ProxyTrustError",
					code: "invalid_payload",
					message: "Proxy request rejected: invalid_payload",
				});
				expect(onError).toHaveBeenCalledWith(
					expect.objectContaining({
						name: "ProxyTrustError",
						code: "invalid_payload",
					}),
				);
				expect(mockProvider.calls.track).toHaveLength(0);
				expect(mockProvider.calls.pageView).toHaveLength(0);
			},
		);
	});

	describe("track trust boundary", () => {
		it("validates raw schema input and dispatches transformed output", async () => {
			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "purchase_completed",
							inputProvided: true,
							input: { orderId: "order_1", amount: "49" },
							occurredAt: 1_725_000_000_000,
						},
					]),
				),
				serverAnalytics,
			);

			expect(mockProvider.calls.track).toHaveLength(1);
			expect(mockProvider.calls.track[0].event).toMatchObject({
				action: "purchase_completed",
				category: "conversion",
				properties: { orderId: "order_1", amount: 49 },
			});
		});

		it("rejects forged post-transform output as invalid raw schema input", async () => {
			const validationError = vi.fn();
			const proxyError = vi.fn();
			const strictAnalytics = createServerAnalytics({
				events: proxyEvents,
				userTraits: typed<UserTraits>(),
				providers: [mockProvider],
				validation: { onFailure: "throw", onError: validationError },
			});
			await strictAnalytics.initialize();

			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "purchase_completed",
							inputProvided: true,
							input: { orderId: "order_1", amount: 49 },
							occurredAt: 1_725_000_000_000,
						},
					]),
				),
				strictAnalytics,
				{ onError: proxyError },
			);

			expect(validationError).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "AnalyticsValidationError",
					code: "invalid_properties",
					eventName: "purchase_completed",
				}),
			);
			expect(proxyError).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "AnalyticsValidationError",
					code: "invalid_properties",
					eventName: "purchase_completed",
				}),
			);
			expect(mockProvider.calls.track).toHaveLength(0);
		});

		it("strips forged identity and server-owned context before provider dispatch", async () => {
			const forged = {
				type: "track",
				name: "button_clicked",
				inputProvided: true,
				input: { buttonId: "cta" },
				occurredAt: 1_725_000_000_000,
				sessionId: "browser-session",
				userId: "forged-user",
				traits: { role: "admin" },
				context: {
					page: { path: "/pricing" },
					user: {
						userId: "forged-user",
						email: "forged@example.com",
						traits: { role: "admin" },
					},
					server: {
						requestId: "forged-request",
						userAgent: "forged-server-agent",
					},
					device: {
						ip: "203.0.113.66",
						userAgent: "forged-device-agent",
						language: "nl-NL",
					},
				},
			} as unknown as ProxyEventV2;

			await ingestProxyEvents(
				requestFor(payload([forged]), {
					"User-Agent": "trusted-request-agent",
					"X-Forwarded-For": "198.51.100.7",
				}),
				serverAnalytics,
				{
					enrichContext: () => ({
						server: { requestId: "trusted-request" },
					}),
				},
			);

			expect(mockProvider.calls.track).toHaveLength(1);
			expect(mockProvider.calls.track[0]).toMatchObject({
				event: {
					action: "button_clicked",
					userId: undefined,
					sessionId: "browser-session",
				},
				context: {
					page: { path: "/pricing" },
					server: {
						requestId: "trusted-request",
						userAgent: "trusted-request-agent",
					},
					device: {
						ip: "198.51.100.7",
						userAgent: "trusted-request-agent",
						language: "nl-NL",
					},
				},
			});
			expect(mockProvider.calls.track[0].context).not.toHaveProperty("user");
			const delivered = JSON.stringify(mockProvider.calls.track[0]);
			expect(delivered).not.toContain("forged-user");
			expect(delivered).not.toContain("forged@example.com");
			expect(delivered).not.toContain("admin");
			expect(delivered).not.toContain("forged-request");
			expect(delivered).not.toContain("forged-server-agent");
			expect(delivered).not.toContain("forged-device-agent");
			expect(delivered).not.toContain("203.0.113.66");
		});

		it("drops a browser-supplied device user-agent when the request has none", async () => {
			const forged = {
				type: "track",
				name: "event1",
				inputProvided: true,
				input: {},
				occurredAt: 1_725_000_000_000,
				context: {
					device: {
						userAgent: "forged-browser-agent",
						language: "nl-NL",
					},
				},
			} as unknown as ProxyEventV2;

			await ingestProxyEvents(requestFor(payload([forged])), serverAnalytics);

			expect(mockProvider.calls.track[0].context?.device).toMatchObject({
				language: "nl-NL",
			});
			expect(
				mockProvider.calls.track[0].context?.device?.userAgent,
			).toBeUndefined();
			expect(JSON.stringify(mockProvider.calls.track[0])).not.toContain(
				"forged-browser-agent",
			);
		});

		it("uses only resolver-derived identity for track events", async () => {
			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "button_clicked",
							inputProvided: true,
							input: { buttonId: "cta" },
							occurredAt: 1_725_000_000_000,
						},
					]),
				),
				serverAnalytics,
				{
					resolveIdentity: async ({ request, event }) => {
						expect(request.url).toBe("http://localhost/api/events");
						expect(event.type).toBe("track");
						return {
							userId: "trusted-user",
							user: {
								email: "trusted@example.com",
								traits: { plan: "pro" as const, role: "member" },
							},
						};
					},
				},
			);

			expect(mockProvider.calls.track[0]).toMatchObject({
				event: { userId: "trusted-user" },
				context: {
					user: {
						userId: "trusted-user",
						email: "trusted@example.com",
						traits: { plan: "pro", role: "member" },
					},
				},
			});
		});

		it("keeps tracks anonymous when identity resolution is absent", async () => {
			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "button_clicked",
							inputProvided: true,
							input: { buttonId: "cta" },
							occurredAt: 1_725_000_000_000,
						},
					]),
				),
				serverAnalytics,
			);

			expect(mockProvider.calls.track[0].event.userId).toBeUndefined();
			expect(mockProvider.calls.track[0].context?.user).toBeUndefined();
		});

		it.each([
			[
				"unknown event",
				{
					type: "track",
					name: "not_registered",
					inputProvided: true,
					input: {},
					occurredAt: 1_725_000_000_000,
				},
				"unknown_event",
			],
			[
				"invalid properties",
				{
					type: "track",
					name: "strict_event",
					inputProvided: true,
					input: { count: "1" },
					occurredAt: 1_725_000_000_000,
				},
				"invalid_properties",
			],
		])(
			"routes %s through the configured server validation policy",
			async (_label, event, code) => {
				const validationError = vi.fn();
				const proxyError = vi.fn();
				const strictAnalytics = createServerAnalytics({
					events: proxyEvents,
					userTraits: typed<UserTraits>(),
					providers: [mockProvider],
					validation: { onFailure: "throw", onError: validationError },
				});
				await strictAnalytics.initialize();

				await ingestProxyEvents(
					requestFor(payload([event as ProxyEventV2])),
					strictAnalytics,
					{ onError: proxyError },
				);

				expect(validationError).toHaveBeenCalledWith(
					expect.objectContaining({ code }),
				);
				expect(proxyError).toHaveBeenCalledWith(
					expect.objectContaining({ code }),
				);
				expect(mockProvider.calls.track).toHaveLength(0);
			},
		);

		it("keeps unknown input out of bounded console errors", async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const strictAnalytics = createServerAnalytics({
				events: proxyEvents,
				providers: [mockProvider],
				validation: { onFailure: "throw" },
			});
			await strictAnalytics.initialize();

			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "DO_NOT_LOG_UNKNOWN_EVENT",
							inputProvided: true,
							input: { value: "DO_NOT_LOG_UNKNOWN_INPUT" },
							occurredAt: 1_725_000_000_000,
						},
					]),
				),
				strictAnalytics,
			);

			const output = JSON.stringify(consoleError.mock.calls);
			expect(consoleError).toHaveBeenCalledTimes(1);
			expect(consoleError.mock.calls[0]).toHaveLength(1);
			expect(output).not.toContain("DO_NOT_LOG");
			expectNoProviderDispatch(mockProvider);
			consoleError.mockRestore();
		});

		it("distinguishes omitted propertyless input from explicit undefined", async () => {
			const validationError = vi.fn();
			const proxyError = vi.fn();
			const strictAnalytics = createServerAnalytics({
				events: proxyEvents,
				userTraits: typed<UserTraits>(),
				providers: [mockProvider],
				validation: { onFailure: "throw", onError: validationError },
			});
			await strictAnalytics.initialize();

			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "session_started",
							inputProvided: false,
							occurredAt: 1_725_000_000_000,
						},
						{
							type: "track",
							name: "session_started",
							inputProvided: true,
							input: undefined,
							occurredAt: 1_725_000_000_001,
						},
					]),
				),
				strictAnalytics,
				{ onError: proxyError },
			);

			expect(mockProvider.calls.track).toHaveLength(1);
			expect(mockProvider.calls.track[0].event).toMatchObject({
				action: "session_started",
				properties: {},
			});
			expect(validationError).toHaveBeenCalledWith(
				expect.objectContaining({
					code: "invalid_properties",
					eventName: "session_started",
				}),
			);
			expect(proxyError).toHaveBeenCalledWith(
				expect.objectContaining({ code: "invalid_properties" }),
			);
		});

		it("processes later events after one event fails validation", async () => {
			const strictAnalytics = createServerAnalytics({
				events: proxyEvents,
				providers: [mockProvider],
				validation: { onFailure: "throw" },
			});
			await strictAnalytics.initialize();

			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "strict_event",
							inputProvided: true,
							input: { count: "invalid" },
							occurredAt: 1_725_000_000_000,
						},
						{
							type: "track",
							name: "event2",
							inputProvided: true,
							input: { source: "proxy" },
							occurredAt: 1_725_000_000_001,
						},
					]),
				),
				strictAnalytics,
				{ onError: vi.fn() },
			);

			expect(mockProvider.calls.track).toHaveLength(1);
			expect(mockProvider.calls.track[0].event.action).toBe("event2");
		});
	});

	describe("identity and page views", () => {
		it("fails identify closed without trusted identity", async () => {
			const onError = vi.fn();

			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "identify",
							userId: "forged-user",
							traits: {
								email: "forged@example.com",
								role: "admin",
							},
						},
					]),
				),
				serverAnalytics,
				{ onError },
			);

			expect(mockProvider.calls.identify).toHaveLength(0);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "ProxyTrustError",
					code: "identity_required",
					message: "Proxy request rejected: identity_required",
				}),
			);
		});

		it("identifies with resolver values and ignores conflicting payload claims", async () => {
			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "identify",
							userId: "forged-user",
							traits: {
								email: "forged@example.com",
								role: "admin",
							},
						},
					]),
				),
				serverAnalytics,
				{
					resolveIdentity: () => ({
						userId: "trusted-user",
						user: {
							email: "trusted@example.com",
							traits: { plan: "pro" as const, role: "member" },
						},
					}),
				},
			);

			expect(mockProvider.calls.identify).toEqual([
				{
					userId: "trusted-user",
					traits: { plan: "pro", role: "member" },
				},
			]);
		});

		it("identifies with the browser's IP and user agent, not the server's", async () => {
			await ingestProxyEvents(
				requestFor(payload([{ type: "identify", userId: "user-1" }]), {
					"x-forwarded-for": "203.0.113.4, 10.0.0.1",
					"user-agent": "Mozilla/5.0 (Macintosh)",
				}),
				serverAnalytics,
				{ resolveIdentity: () => ({ userId: "trusted-user" }) },
			);

			expect(mockProvider.calls.identify[0]?.context).toEqual({
				server: { ip: "203.0.113.4", userAgent: "Mozilla/5.0 (Macintosh)" },
			});
		});

		it("uses resolver identity for page views and keeps unresolved page views anonymous", async () => {
			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "pageView",
							properties: { audience: "member" },
							occurredAt: 1_725_000_000_000,
							context: { page: { path: "/members" } },
						},
						{
							type: "pageView",
							properties: { audience: "anonymous" },
							occurredAt: 1_725_000_000_001,
							context: { page: { path: "/landing" } },
						},
					]),
				),
				serverAnalytics,
				{
					resolveIdentity: ({ event }) =>
						event.type === "pageView" && event.properties?.audience === "member"
							? {
									userId: "trusted-user",
									user: {
										email: "trusted@example.com",
										traits: { plan: "pro" as const },
									},
								}
							: undefined,
				},
			);

			expect(mockProvider.calls.pageView).toHaveLength(2);
			expect(mockProvider.calls.pageView[0]).toMatchObject({
				properties: { audience: "member" },
				context: {
					page: { path: "/members" },
					user: {
						userId: "trusted-user",
						email: "trusted@example.com",
						traits: { plan: "pro" },
					},
				},
			});
			expect(mockProvider.calls.pageView[1]).toMatchObject({
				properties: { audience: "anonymous" },
				context: { page: { path: "/landing" } },
			});
			expect(mockProvider.calls.pageView[1].context?.user).toBeUndefined();
		});

		it("suppresses ServerAnalytics default identity when no resolver is configured", async () => {
			const provider = new MockAnalyticsProvider();
			const analytics = createServerAnalytics({
				events: proxyEvents,
				userTraits: typed<UserTraits>(),
				providers: [provider],
				defaultContext: {
					user: {
						userId: "default-user",
						email: "default@example.com",
						traits: { role: "default-admin" },
					},
				},
			});
			await analytics.initialize();

			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "event1",
							inputProvided: true,
							input: {},
							occurredAt: 1_725_000_000_000,
						},
						{
							type: "pageView",
							occurredAt: 1_725_000_000_001,
							context: { page: { path: "/anonymous" } },
						},
					]),
				),
				analytics,
			);

			expect(provider.calls.track[0].event.userId).toBeUndefined();
			expect(provider.calls.track[0].context?.user).toBeUndefined();
			expect(provider.calls.pageView[0].context?.user).toBeUndefined();
			expect(JSON.stringify(provider.calls)).not.toContain("default-user");
			expect(JSON.stringify(provider.calls)).not.toContain(
				"default@example.com",
			);
			expect(JSON.stringify(provider.calls)).not.toContain("default-admin");
		});

		it("keeps reset as a server no-op", async () => {
			await ingestProxyEvents(
				requestFor(payload([{ type: "reset" }])),
				serverAnalytics,
			);

			expect(mockProvider.calls.reset).toBe(0);
		});
	});

	describe("server enrichment and handlers", () => {
		it.each([
			["X-Forwarded-For", "1.2.3.4, 5.6.7.8", "1.2.3.4"],
			["X-Real-IP", "9.8.7.6", "9.8.7.6"],
			["CF-Connecting-IP", "1.1.1.1", "1.1.1.1"],
		])("extracts IP from %s", async (header, value, expected) => {
			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "event1",
							inputProvided: true,
							input: {},
							occurredAt: 1_725_000_000_000,
						},
					]),
					{ [header]: value },
				),
				serverAnalytics,
			);

			expect(mockProvider.calls.track[0].context?.device?.ip).toBe(expected);
		});

		it("uses custom IP extraction and server enrichment", async () => {
			await ingestProxyEvents(
				requestFor(
					payload([
						{
							type: "track",
							name: "event1",
							inputProvided: true,
							input: {},
							occurredAt: 1_725_000_000_000,
						},
					]),
					{
						"X-Custom-IP": "10.0.0.1",
						"User-Agent": "Test/1.0",
					},
				),
				serverAnalytics,
				{
					extractIp: (request) =>
						request.headers.get("x-custom-ip") ?? undefined,
					enrichContext: () => ({
						server: { region: "eu-west-1", requestId: "req-123" },
					}),
				},
			);

			expect(mockProvider.calls.track[0].context).toMatchObject({
				device: { ip: "10.0.0.1", userAgent: "Test/1.0" },
				server: {
					region: "eu-west-1",
					requestId: "req-123",
					userAgent: "Test/1.0",
				},
			});
		});

		it("creates a working standard Request/Response handler", async () => {
			const handler = createProxyHandler(serverAnalytics);
			const response = await handler(
				requestFor(
					payload([
						{
							type: "track",
							name: "event1",
							inputProvided: true,
							input: { source: "serverless" },
							occurredAt: 1_725_000_000_000,
						},
					]),
				),
			);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("OK");
			expect(mockProvider.calls.track).toHaveLength(1);
		});

		it("reports direct-ingest parsing errors exactly once without retaining payload data", async () => {
			const onError = vi.fn();
			const request = rawRequest("private-invalid-json", {
				headers: { "Content-Type": "application/json" },
			});

			await expect(
				ingestProxyEvents(request, serverAnalytics, { onError }),
			).rejects.toMatchObject({
				name: "ProxyIngestError",
				code: "invalid_payload",
				status: 400,
			});

			expect(onError).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(onError.mock.calls)).not.toContain(
				"private-invalid-json",
			);
			expectNoProviderDispatch(mockProvider);
		});
	});

	describe("bounded request handler", () => {
		it("rejects non-POST methods with the allowed method and no dispatch", async () => {
			const handler = createProxyHandler(serverAnalytics);
			const response = await handler(rawRequest("", { method: "GET" }));

			await expectErrorResponse(response, 405, "method_not_allowed");
			expect(response.headers.get("allow")).toBe("POST");
			expectNoProviderDispatch(mockProvider);
		});

		it("rejects non-JSON media types before reading or dispatching", async () => {
			const handler = createProxyHandler(serverAnalytics);
			const request = rawRequest("private-body", {
				headers: { "Content-Type": "text/plain" },
			});

			const response = await handler(request);

			await expectErrorResponse(response, 415, "unsupported_media_type");
			expect(request.bodyUsed).toBe(false);
			expectNoProviderDispatch(mockProvider);
		});

		it("returns invalid_payload for malformed JSON exactly once", async () => {
			const onError = vi.fn();
			const handler = createProxyHandler(serverAnalytics, { onError });
			const request = rawRequest("private-invalid-json", {
				headers: { "Content-Type": "application/json" },
			});

			const response = await handler(request);

			await expectErrorResponse(response, 400, "invalid_payload");
			expect(onError).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(onError.mock.calls)).not.toContain(
				"private-invalid-json",
			);
			expectNoProviderDispatch(mockProvider);
		});

		it.each([
			["missing", { events: [] }],
			["wrong", { version: 1, events: [] }],
		])(
			"maps a %s V2 version to safe invalid_payload JSON",
			async (_label, body) => {
				const onError = vi.fn();
				const handler = createProxyHandler(serverAnalytics, { onError });

				const response = await handler(requestFor(body));

				await expectErrorResponse(response, 400, "invalid_payload");
				expect(onError).toHaveBeenCalledTimes(1);
				expectNoProviderDispatch(mockProvider);
			},
		);

		it("rejects declared bodies above the limit without reading them", async () => {
			const handler = createProxyHandler(serverAnalytics, {
				maxBodyBytes: 32,
			});
			const request = rawRequest(JSON.stringify({ version: 2, events: [] }), {
				headers: {
					"Content-Type": "application/json",
					"Content-Length": "33",
				},
			});

			const response = await handler(request);

			await expectErrorResponse(response, 413, "body_too_large");
			expect(request.bodyUsed).toBe(false);
			expectNoProviderDispatch(mockProvider);
		});

		it("measures actual UTF-8 bytes rather than JavaScript characters", async () => {
			const body = JSON.stringify({
				version: 2,
				events: [],
				padding: "ééé",
			});
			const handler = createProxyHandler(serverAnalytics, {
				maxBodyBytes: body.length,
			});
			const request = rawRequest(body, {
				headers: { "Content-Type": "application/json" },
			});

			const response = await handler(request);

			await expectErrorResponse(response, 413, "body_too_large");
			expect(request.bodyUsed).toBe(true);
			expectNoProviderDispatch(mockProvider);
		});

		it("rejects event batches above the configured limit", async () => {
			const handler = createProxyHandler(serverAnalytics, {
				maxBatchSize: 1,
			});

			const response = await handler(
				requestFor(
					payload([
						{
							type: "track",
							name: "event1",
							inputProvided: true,
							input: { position: 1 },
							occurredAt: 1_725_000_000_000,
						},
						{
							type: "track",
							name: "event2",
							inputProvided: true,
							input: { position: 2 },
							occurredAt: 1_725_000_000_001,
						},
					]),
				),
			);

			await expectErrorResponse(response, 413, "body_too_large");
			expectNoProviderDispatch(mockProvider);
		});

		it("rejects unauthorized requests before admission or body parsing", async () => {
			const order: string[] = [];
			const admit = vi.fn(() => {
				order.push("admit");
				return true;
			});
			const handler = createProxyHandler(serverAnalytics, {
				authorize: async () => {
					order.push("authorize");
					return false;
				},
				admit,
			});
			const request = rawRequest("private-body", {
				headers: { "Content-Type": "application/json" },
			});

			const response = await handler(request);

			await expectErrorResponse(response, 401, "unauthorized");
			expect(order).toEqual(["authorize"]);
			expect(admit).not.toHaveBeenCalled();
			expect(request.bodyUsed).toBe(false);
			expectNoProviderDispatch(mockProvider);
		});

		it("runs admission after authorization and before body parsing", async () => {
			const order: string[] = [];
			const handler = createProxyHandler(serverAnalytics, {
				authorize: () => {
					order.push("authorize");
					return true;
				},
				admit: async () => {
					order.push("admit");
					return false;
				},
			});
			const request = rawRequest("private-body", {
				headers: { "Content-Type": "application/json" },
			});

			const response = await handler(request);

			await expectErrorResponse(response, 429, "rate_limited");
			expect(order).toEqual(["authorize", "admit"]);
			expect(request.bodyUsed).toBe(false);
			expectNoProviderDispatch(mockProvider);
		});

		it("accepts JSON media-type casing and parameters within default limits", async () => {
			const handler = createProxyHandler(serverAnalytics);
			const response = await handler(
				requestFor(
					payload([
						{
							type: "track",
							name: "event1",
							inputProvided: true,
							input: { source: "defaults" },
							occurredAt: 1_725_000_000_000,
						},
					]),
					{ "Content-Type": "Application/JSON; Charset=UTF-8" },
				),
			);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("OK");
			expect(mockProvider.calls.track).toHaveLength(1);
		});

		it("returns a payload-free internal error when authorization throws", async () => {
			const privateError = new Error("token=private-credential");
			const onError = vi.fn();
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const handler = createProxyHandler(serverAnalytics, {
				authorize: () => {
					throw privateError;
				},
				onError,
			});
			const request = rawRequest("private-request-body", {
				headers: { "Content-Type": "application/json" },
			});

			try {
				const response = await handler(request);

				await expectErrorResponse(response, 500, "internal_error");
				expect(onError).toHaveBeenCalledTimes(1);
				expect(onError).toHaveBeenCalledWith(privateError);
				expect(request.bodyUsed).toBe(false);
				expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
					"private-credential",
				);
				expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
					"private-request-body",
				);
				expectNoProviderDispatch(mockProvider);
			} finally {
				consoleError.mockRestore();
			}
		});

		it("rethrows an original authorization failure whose prototype cannot be inspected", async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const originalError = new Proxy(
				{},
				{
					getPrototypeOf() {
						throw new Error("DO_NOT_LOG_PROTOTYPE_TRAP");
					},
				},
			);
			const request = requestFor(payload([]));

			await expect(
				ingestProxyEvents(request, serverAnalytics, {
					authorize: () => {
						throw originalError;
					},
				}),
			).rejects.toBe(originalError);
			expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
				"DO_NOT_LOG",
			);
			consoleError.mockRestore();
		});

		it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
			"rejects invalid maxBodyBytes %s before body consumption",
			async (maxBodyBytes) => {
				const onError = vi.fn();
				const request = requestFor(payload([]));

				await expect(
					ingestProxyEvents(request, serverAnalytics, {
						maxBodyBytes,
						onError,
					}),
				).rejects.toBeInstanceOf(TypeError);

				expect(onError).toHaveBeenCalledTimes(1);
				expect(request.bodyUsed).toBe(false);
				expectNoProviderDispatch(mockProvider);
			},
		);

		it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
			"rejects invalid maxBatchSize %s before body consumption",
			async (maxBatchSize) => {
				const onError = vi.fn();
				const request = requestFor(payload([]));

				await expect(
					ingestProxyEvents(request, serverAnalytics, {
						maxBatchSize,
						onError,
					}),
				).rejects.toBeInstanceOf(TypeError);

				expect(onError).toHaveBeenCalledTimes(1);
				expect(request.bodyUsed).toBe(false);
				expectNoProviderDispatch(mockProvider);
			},
		);

		it("reports event-level identity errors once while continuing ingestion", async () => {
			const onError = vi.fn();
			const handler = createProxyHandler(serverAnalytics, { onError });

			const response = await handler(
				requestFor(
					payload([
						{
							type: "identify",
							userId: "untrusted-user",
						},
						{
							type: "track",
							name: "event1",
							inputProvided: true,
							input: { source: "after-identify" },
							occurredAt: 1_725_000_000_000,
						},
					]),
				),
			);

			expect(response.status).toBe(200);
			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "ProxyTrustError",
					code: "identity_required",
				}),
			);
			expect(mockProvider.calls.identify).toHaveLength(0);
			expect(mockProvider.calls.track).toHaveLength(1);
		});
	});
});
