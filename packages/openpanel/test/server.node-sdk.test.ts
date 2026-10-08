import { defineEvents, typed } from "trakoo";
import { createServerAnalytics } from "trakoo/server";
import { OpenPanelServerProvider } from "../src/server.js";
import type { OpenPanelServerConfig } from "../src/server.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the real `@openpanel/sdk` client rather than a mock, because the
 * request context has to survive the SDK's own payload handling to become a
 * header on the outgoing request.
 */
describe("OpenPanelServerProvider with the node SDK", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const stubFetch = () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			// Real fetch refuses a header value it cannot send before any request
			// leaves, so the stub does too.
			void new Headers(init?.headers);
			return { status: 202, text: () => Promise.resolve("") };
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	};

	const createProvider = async (
		config: Partial<OpenPanelServerConfig> = {},
	) => {
		const provider = new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "client-secret",
			...config,
		});
		await provider.initialize();
		return provider;
	};

	const requestsOf = (fetchMock: ReturnType<typeof stubFetch>) =>
		fetchMock.mock.calls.map(([, request]) => ({
			body: JSON.parse(String(request?.body)),
			headers: request?.headers as Record<string, string>,
		}));

	it("sends the caller's IP and user agent as headers, not properties", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();

		await provider.track(
			{
				action: "api_request",
				category: "engagement",
				properties: { route: "/v1/generations" },
			},
			{ server: { ip: "203.0.113.4", userAgent: "acme-sdk/1.2" } },
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		const headers = request.headers as Record<string, string>;

		expect(headers["openpanel-client-ip"]).toBe("203.0.113.4");
		expect(headers["user-agent"]).toBe("acme-sdk/1.2");

		const body = JSON.parse(String(request.body));
		expect(body.payload.properties.route).toBe("/v1/generations");
		// Nothing named after the carrier survives serialization, whatever the
		// key: the symbol is invisible to JSON.stringify.
		expect(Object.keys(body.payload.properties)).not.toContain(
			"__trakooRequestContext",
		);
		expect(JSON.stringify(body)).not.toContain("acme-sdk/1.2");
		expect(String(request.body)).not.toContain("203.0.113.4");
	});

	it("attributes concurrent requests to their own caller", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();

		await Promise.all([
			provider.track(
				{ action: "api_request", category: "engagement" },
				{ server: { ip: "203.0.113.4" } },
			),
			provider.track(
				{ action: "api_request", category: "engagement" },
				{ server: { ip: "198.51.100.7" } },
			),
			provider.track({ action: "api_request", category: "engagement" }),
		]);

		const ips = fetchMock.mock.calls.map(
			(call) =>
				((call as [string, RequestInit])[1].headers as Record<string, string>)[
					"openpanel-client-ip"
				],
		);
		expect(ips).toHaveLength(3);
		expect(new Set(ips)).toEqual(
			new Set(["203.0.113.4", "198.51.100.7", undefined]),
		);
	});

	it("leaves the request unchanged when no context is supplied", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();

		await provider.track({ action: "api_request", category: "engagement" });

		const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		const headers = request.headers as Record<string, string>;
		expect(headers["openpanel-client-ip"]).toBeUndefined();
		expect(headers["user-agent"]).toBeUndefined();
		expect(headers["openpanel-client-id"]).toBe("client-id");
	});

	it("falls back to the device user agent when the server one cannot be sent", async () => {
		const fetchMock = stubFetch();
		const onDeliveryFailure = vi.fn();
		const provider = await createProvider({ onDeliveryFailure });

		await provider.track(
			{ action: "api_request", category: "engagement" },
			{
				server: {
					ip: "203.0.113.4",
					userAgent: "acme-sdk/1.2\r\nx-injected: 1",
				},
				device: { userAgent: "Mozilla/5.0 (Macintosh)" },
			},
		);

		expect(onDeliveryFailure).not.toHaveBeenCalled();
		const [request] = requestsOf(fetchMock);
		expect(requestsOf(fetchMock)).toHaveLength(1);
		expect(request?.headers["user-agent"]).toBe("Mozilla/5.0 (Macintosh)");
		expect(request?.headers["openpanel-client-ip"]).toBe("203.0.113.4");
		expect(request?.headers["x-injected"]).toBeUndefined();
	});

	it("delivers the event without an attribute that is not a valid header value", async () => {
		const fetchMock = stubFetch();
		const onDeliveryFailure = vi.fn();
		const provider = await createProvider({ onDeliveryFailure });

		// Characters above U+00FF cannot be sent in a header at all, so the
		// SDK's fetch would reject the whole request, retry it, and drop it.
		await provider.track(
			{ action: "api_request", category: "engagement" },
			{ server: { ip: "203.0.113.4", userAgent: "acme-sdk — beta" } },
		);

		expect(onDeliveryFailure).not.toHaveBeenCalled();
		const requests = requestsOf(fetchMock);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.headers["user-agent"]).toBeUndefined();
		expect(requests[0]?.headers["openpanel-client-ip"]).toBe("203.0.113.4");
		expect(requests[0]?.body.payload.name).toBe("api_request");
	});

	it("sends no profile for an identify without traits", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();

		// OpenPanel only writes a profile when there is more than the ID.
		await provider.identify("user-a");
		expect(fetchMock).not.toHaveBeenCalled();

		await provider.identify("user-a", { plan: "pro" });
		expect(requestsOf(fetchMock).map(({ body }) => body)).toEqual([
			{
				type: "identify",
				payload: { profileId: "user-a", properties: { plan: "pro" } },
			},
		]);
	});

	it("places an identified profile at the caller, not the server", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();

		await provider.identify(
			"user-a",
			{ email: "a@example.com", plan: "pro" },
			{ server: { ip: "203.0.113.4", userAgent: "Mozilla/5.0 (Macintosh)" } },
		);

		const [request] = requestsOf(fetchMock);
		expect(requestsOf(fetchMock)).toHaveLength(1);
		expect(request?.headers["openpanel-client-ip"]).toBe("203.0.113.4");
		expect(request?.headers["user-agent"]).toBe("Mozilla/5.0 (Macintosh)");
		expect(request?.body).toEqual({
			type: "identify",
			payload: {
				profileId: "user-a",
				email: "a@example.com",
				properties: { plan: "pro" },
			},
		});
	});

	it("sends an identify without traits when it can place the profile", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();

		await provider.identify("user-a", undefined, {
			device: { ip: "203.0.113.4" },
		});

		const [request] = requestsOf(fetchMock);
		expect(request?.headers["openpanel-client-ip"]).toBe("203.0.113.4");
		expect(request?.body).toEqual({
			type: "identify",
			payload: { profileId: "user-a", properties: {} },
		});
	});

	it("passes the identify context from server analytics to the request", async () => {
		const fetchMock = stubFetch();
		const analytics = createServerAnalytics({
			events: defineEvents({}),
			providers: [await createProvider()],
		});

		await analytics.identify(
			"user-a",
			{ plan: "pro" },
			{ context: { server: { ip: "203.0.113.4" } } },
		);
		await analytics.identify("user-b", { plan: "free" });

		const [placed, unplaced] = requestsOf(fetchMock);
		expect(placed?.headers["openpanel-client-ip"]).toBe("203.0.113.4");
		expect(unplaced?.body.payload.profileId).toBe("user-b");
		expect(unplaced?.headers["openpanel-client-ip"]).toBeUndefined();
	});

	it("never holds anonymous events for the next identified user", async () => {
		const fetchMock = stubFetch();
		// An untyped caller can hand the provider SDK queueing options. With
		// them the SDK held the event and released it under the next identify.
		const provider = await createProvider({
			waitForProfile: true,
		} as Partial<OpenPanelServerConfig>);

		await provider.track({ action: "anonymous_event", category: "engagement" });
		await provider.identify("user-a", { plan: "pro" });

		const tracks = requestsOf(fetchMock)
			.map(({ body }) => body)
			.filter((body) => body.type === "track");
		expect(tracks).toHaveLength(1);
		expect(tracks[0]?.payload.name).toBe("anonymous_event");
		expect(tracks[0]?.payload.profileId).toBeUndefined();
	});

	it("sends an event recorded after the fact at the time it happened", async () => {
		const fetchMock = stubFetch();
		const analytics = createServerAnalytics({
			events: defineEvents({
				siteCreated: {
					name: "site_created",
					category: "conversion",
					properties: typed<{ siteId: string }>(),
				},
			}),
			providers: [await createProvider()],
			validation: { onFailure: "throw" },
		});

		await analytics.track(
			"site_created",
			{ siteId: "site-1" },
			{ userId: "user-a", occurredAt: new Date("2026-09-30T08:15:42.123Z") },
		);

		const [request] = requestsOf(fetchMock);
		expect(request?.body.payload.properties.__timestamp).toBe(
			"2026-09-30T08:15:42.123Z",
		);
	});

	it("sends an event to its groups without keeping them on the shared client", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();
		const analytics = createServerAnalytics({
			events: defineEvents({
				siteCreated: {
					name: "site_created",
					category: "conversion",
					properties: typed<{ siteId: string }>(),
				},
			}),
			providers: [provider],
			validation: { onFailure: "throw" },
		});

		await analytics.track(
			"site_created",
			{ siteId: "site-1" },
			{ userId: "user-a", groups: { organization: "org-1" } },
		);
		await analytics.track(
			"site_created",
			{ siteId: "site-2" },
			{ userId: "user-b" },
		);

		const [grouped, ungrouped] = requestsOf(fetchMock);
		expect(grouped?.body.payload.groups).toEqual(["org-1"]);
		expect(grouped?.body.payload.properties).not.toHaveProperty("groups");
		expect(ungrouped?.body.payload.profileId).toBe("user-b");
		expect(ungrouped?.body.payload).not.toHaveProperty("groups");
	});

	it("upserts a group, then adds the user to it by name", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();
		const analytics = createServerAnalytics({
			events: defineEvents({
				siteCreated: {
					name: "site_created",
					category: "conversion",
					properties: typed<{ siteId: string }>(),
				},
			}),
			providers: [provider],
		});

		await analytics.group(
			"organization",
			"org-1",
			{ planId: "free", seats: undefined, trial: null },
			{ userId: "user-a" },
		);
		await analytics.track(
			"site_created",
			{ siteId: "site-1" },
			{ userId: "user-b" },
		);

		expect(requestsOf(fetchMock).map(({ body }) => body)).toEqual([
			{
				type: "group",
				payload: {
					id: "org-1",
					type: "organization",
					// No name trait: OpenPanel requires one, so the id stands in.
					name: "org-1",
					properties: { planId: "free" },
				},
			},
			{
				type: "assign_group",
				payload: { groupIds: ["org-1"], profileId: "user-a" },
			},
			expect.objectContaining({
				type: "track",
				payload: expect.not.objectContaining({ groups: expect.anything() }),
			}),
		]);
		const [, , track] = requestsOf(fetchMock);
		expect(track?.body.payload.profileId).toBe("user-b");
	});

	it("names a group by its name trait unless routed without personal data", async () => {
		const fetchMock = stubFetch();
		const analytics = createServerAnalytics({
			events: defineEvents({}),
			providers: [{ provider: await createProvider(), pii: false }],
		});
		const named = createServerAnalytics({
			events: defineEvents({}),
			providers: [await createProvider()],
		});

		await analytics.group("company", "acme", { name: "Acme Ltd" });
		await named.group("company", "acme", { name: "Acme Ltd" });

		expect(requestsOf(fetchMock).map(({ body }) => body.payload.name)).toEqual([
			"acme",
			"Acme Ltd",
		]);
	});
	it("records revenue for its user and groups, at the time it was received", async () => {
		const fetchMock = stubFetch();
		const analytics = createServerAnalytics({
			events: defineEvents({
				siteCreated: {
					name: "site_created",
					category: "conversion",
					properties: typed<{ siteId: string }>(),
				},
			}),
			providers: [await createProvider()],
			validation: { onFailure: "throw" },
		});

		await analytics.revenue(
			4900,
			{ planId: "pro", kind: "renewal" },
			{
				currency: "EUR",
				userId: "user-a",
				groups: { organization: "org-1" },
				occurredAt: new Date("2026-10-08T09:30:00.000Z"),
			},
		);
		await analytics.track(
			"site_created",
			{ siteId: "site-1" },
			{ userId: "user-b" },
		);

		const [revenue, next] = requestsOf(fetchMock);
		expect(revenue?.headers["openpanel-client-secret"]).toBe("client-secret");
		expect(revenue?.body).toEqual({
			type: "track",
			payload: {
				name: "revenue",
				profileId: "user-a",
				groups: ["org-1"],
				properties: {
					planId: "pro",
					kind: "renewal",
					currency: "EUR",
					__timestamp: "2026-10-08T09:30:00.000Z",
					// What OpenPanel sums as revenue: an integer, in minor units.
					__revenue: 4900,
				},
			},
		});
		// Neither the profile nor the group stays on the shared client.
		expect(next?.body.payload.profileId).toBe("user-b");
		expect(next?.body.payload).not.toHaveProperty("groups");
	});

	it("lets the amount win over a property named like OpenPanel's own", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();

		await provider.revenue({
			amount: 100,
			properties: { __revenue: 999_999 },
			timestamp: Date.parse("2026-10-08T09:30:00.000Z"),
		});

		const [request] = requestsOf(fetchMock);
		expect(request?.body.payload.properties.__revenue).toBe(100);
		expect(request?.body.payload.profileId).toBeUndefined();
	});

	it("turns a deviceId property into the event's device, linking it to the visitor", async () => {
		const fetchMock = stubFetch();
		const provider = await createProvider();

		await provider.revenue({
			amount: 100,
			userId: "user-a",
			properties: { deviceId: "browser-device-1" },
			timestamp: Date.parse("2026-10-08T09:30:00.000Z"),
		});

		const [request] = requestsOf(fetchMock);
		expect(request?.body.payload.properties.__deviceId).toBe(
			"browser-device-1",
		);
		expect(request?.body.payload.properties).not.toHaveProperty("deviceId");
	});

	it("reports a rejected revenue through onDeliveryFailure", async () => {
		const fetchMock = vi.fn(async () => ({
			status: 401,
			text: () => Promise.resolve(""),
		}));
		vi.stubGlobal("fetch", fetchMock);
		const onDeliveryFailure = vi.fn();
		const provider = await createProvider({ onDeliveryFailure });

		await provider.revenue({ amount: 100, timestamp: Date.now() });

		expect(onDeliveryFailure).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ reason: "unauthorized", status: 401 }),
		);
	});
});
