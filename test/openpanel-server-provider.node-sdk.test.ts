import { OpenPanelServerProvider } from "@/providers/openpanel/server.js";
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
		const fetchMock = vi.fn().mockResolvedValue({
			status: 202,
			text: vi.fn().mockResolvedValue(""),
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	};

	const createProvider = async () => {
		const provider = new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "client-secret",
		});
		await provider.initialize();
		return provider;
	};

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
});
