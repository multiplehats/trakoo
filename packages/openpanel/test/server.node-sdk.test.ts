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
});
