import { OpenPanelServerProvider } from "@/providers/openpanel/server.js";
import {
	REQUEST_CONTEXT_PROPERTY,
	createDeliveryFailureReporter,
	instrumentOpenPanelDelivery,
} from "@/providers/openpanel/transport.js";
import type { OpenPanelDeliveryFailure } from "@/providers/openpanel/transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeApi {
	baseUrl: string;
	fetch: (
		path: string,
		data: unknown,
		options?: RequestInit,
	) => Promise<unknown>;
	headers: Record<string, string | Promise<string | null>>;
	initialRetryDelay?: number;
	maxRetries?: number;
}

const trackEnvelope = {
	type: "track",
	payload: { name: "checkout_started" },
};

const response = (status: number, body = "") => ({
	status,
	text: () => Promise.resolve(body),
});

const createClient = (overrides: Partial<FakeApi> = {}) => ({
	api: {
		baseUrl: "https://api.example.com",
		fetch: () => Promise.resolve(null),
		headers: { "openpanel-client-id": "client-id" },
		initialRetryDelay: 0,
		...overrides,
	} satisfies FakeApi as FakeApi,
});

describe("OpenPanel delivery reporting", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("reports a rejected key once, without retrying it", async () => {
		const fetchMock = vi.fn().mockResolvedValue(response(401));
		vi.stubGlobal("fetch", fetchMock);
		const report = vi.fn();
		const client = createClient({ maxRetries: 3 });

		expect(instrumentOpenPanelDelivery(client, report)).toBe(true);
		await expect(client.api.fetch("/track", trackEnvelope)).resolves.toBeNull();

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledExactlyOnceWith({
			attempts: 1,
			payloadType: "track",
			reason: "unauthorized",
			status: 401,
			url: "https://api.example.com/track",
		});
	});

	it("retries server errors and reports once the retries are exhausted", async () => {
		const fetchMock = vi.fn().mockResolvedValue(response(500));
		vi.stubGlobal("fetch", fetchMock);
		const report = vi.fn();
		const client = createClient({ initialRetryDelay: 0, maxRetries: 2 });

		instrumentOpenPanelDelivery(client, report);
		await expect(client.api.fetch("/track", trackEnvelope)).resolves.toBeNull();

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(report).toHaveBeenCalledExactlyOnceWith({
			attempts: 3,
			payloadType: "track",
			reason: "server_error",
			status: 500,
			url: "https://api.example.com/track",
		});
	});

	it("reports transport failures without inventing a status", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
		const report = vi.fn();
		const client = createClient({ maxRetries: 0 });

		instrumentOpenPanelDelivery(client, report);
		await client.api.fetch("/track", trackEnvelope);

		const failure = report.mock.calls[0]?.[0] as OpenPanelDeliveryFailure;
		expect(failure.reason).toBe("network_error");
		expect(failure.attempts).toBe(1);
		expect("status" in failure).toBe(false);
	});

	it("returns accepted responses unchanged and reports nothing", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response(200, '{"deviceId":"device-1"}'))
			.mockResolvedValueOnce(response(202));
		vi.stubGlobal("fetch", fetchMock);
		const report = vi.fn();
		const client = createClient();

		instrumentOpenPanelDelivery(client, report);

		await expect(client.api.fetch("/track", trackEnvelope)).resolves.toEqual({
			deviceId: "device-1",
		});
		await expect(client.api.fetch("/track", trackEnvelope)).resolves.toBeNull();
		expect(report).not.toHaveBeenCalled();
	});

	it("sends the request the OpenPanel transport would have sent", async () => {
		const fetchMock = vi.fn().mockResolvedValue(response(202));
		vi.stubGlobal("fetch", fetchMock);
		const client = createClient({
			headers: {
				"openpanel-client-id": "client-id",
				"openpanel-client-secret": Promise.resolve("client-secret"),
				"openpanel-unset": Promise.resolve(null),
			},
		});

		instrumentOpenPanelDelivery(client, vi.fn());
		await client.api.fetch("/track", trackEnvelope);
		await client.api.fetch("/track", trackEnvelope, { keepalive: false });

		const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.example.com/track");
		expect(request.method).toBe("POST");
		expect(request.keepalive).toBe(true);
		expect(request.body).toBe(JSON.stringify(trackEnvelope));
		expect(request.headers).toEqual({
			"openpanel-client-id": "client-id",
			"openpanel-client-secret": "client-secret",
		});

		const [, replayRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(replayRequest.keepalive).toBe(false);
	});

	it("moves the request context onto this one request's headers", async () => {
		const fetchMock = vi.fn().mockResolvedValue(response(202));
		vi.stubGlobal("fetch", fetchMock);
		const client = createClient();

		instrumentOpenPanelDelivery(client, vi.fn());
		await client.api.fetch("/track", {
			type: "track",
			payload: {
				name: "api_request",
				properties: {
					route: "/v1/generations",
					[REQUEST_CONTEXT_PROPERTY]: {
						ip: "203.0.113.4",
						userAgent: "acme-sdk/1.2",
					},
				},
			},
		});

		const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(request.headers).toEqual({
			"openpanel-client-id": "client-id",
			"openpanel-client-ip": "203.0.113.4",
			"user-agent": "acme-sdk/1.2",
		});
		// The carrier is transport-only: it never reaches OpenPanel as a property.
		expect(JSON.parse(String(request.body))).toEqual({
			type: "track",
			payload: {
				name: "api_request",
				properties: { route: "/v1/generations" },
			},
		});
	});

	it("does not let one request's context leak onto the next", async () => {
		const fetchMock = vi.fn().mockResolvedValue(response(202));
		vi.stubGlobal("fetch", fetchMock);
		const client = createClient();
		const envelope = {
			type: "track",
			payload: {
				name: "api_request",
				properties: {
					[REQUEST_CONTEXT_PROPERTY]: { ip: "203.0.113.4" },
				},
			},
		};

		instrumentOpenPanelDelivery(client, vi.fn());
		await client.api.fetch("/track", envelope);
		await client.api.fetch("/track", trackEnvelope);

		const [, second] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(second.headers).toEqual({ "openpanel-client-id": "client-id" });
		// Delivery copies the payload; the SDK's own object is left intact.
		expect(envelope.payload.properties).toEqual({
			[REQUEST_CONTEXT_PROPERTY]: { ip: "203.0.113.4" },
		});
	});

	it("sends partial request context and ignores a malformed carrier", async () => {
		const fetchMock = vi.fn().mockResolvedValue(response(202));
		vi.stubGlobal("fetch", fetchMock);
		const client = createClient();

		instrumentOpenPanelDelivery(client, vi.fn());
		await client.api.fetch("/track", {
			type: "track",
			payload: {
				name: "a",
				properties: { [REQUEST_CONTEXT_PROPERTY]: { ip: "203.0.113.4" } },
			},
		});
		await client.api.fetch("/track", {
			type: "track",
			payload: {
				name: "b",
				properties: { [REQUEST_CONTEXT_PROPERTY]: "not-an-object" },
			},
		});

		const [, withIp] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(withIp.headers).toEqual({
			"openpanel-client-id": "client-id",
			"openpanel-client-ip": "203.0.113.4",
		});

		const [, malformed] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(malformed.headers).toEqual({ "openpanel-client-id": "client-id" });
	});

	it("leaves clients without a recognizable transport untouched", () => {
		const report = vi.fn();

		expect(instrumentOpenPanelDelivery(undefined, report)).toBe(false);
		expect(instrumentOpenPanelDelivery({}, report)).toBe(false);
		expect(instrumentOpenPanelDelivery({ api: {} }, report)).toBe(false);
		expect(
			instrumentOpenPanelDelivery(
				{ api: { baseUrl: "https://api.example.com", fetch: () => null } },
				report,
			),
		).toBe(false);
	});

	it("logs delivery failures when no handler is configured", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		createDeliveryFailureReporter(
			"OpenPanel-Server",
			undefined,
		)({
			attempts: 1,
			reason: "unauthorized",
			status: 401,
			url: "https://api.example.com/track",
		});

		expect(consoleError).toHaveBeenCalledOnce();
		const message = String(consoleError.mock.calls[0]?.[0]);
		expect(message).toContain("[OpenPanel-Server]");
		expect(message).toContain("unauthorized");
		expect(message).toContain("allowed origins");
	});

	it("keeps a throwing handler from failing an event", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const onDeliveryFailure = vi.fn(() => {
			throw new Error("reporting is broken");
		});

		expect(() =>
			createDeliveryFailureReporter(
				"OpenPanel-Server",
				onDeliveryFailure,
			)({
				attempts: 1,
				reason: "unauthorized",
				status: 401,
				url: "https://api.example.com/track",
			}),
		).not.toThrow();
		expect(onDeliveryFailure).toHaveBeenCalledOnce();
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("reports a rejected key through the server provider and real SDK", async () => {
		const fetchMock = vi.fn().mockResolvedValue(response(401));
		vi.stubGlobal("fetch", fetchMock);
		const onDeliveryFailure = vi.fn();

		const provider = new OpenPanelServerProvider({
			clientId: "client-id",
			clientSecret: "client-secret",
			onDeliveryFailure,
		});
		await provider.initialize();
		await provider.track({
			action: "checkout_started",
			category: "conversion",
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(onDeliveryFailure).toHaveBeenCalledExactlyOnceWith({
			attempts: 1,
			payloadType: "track",
			reason: "unauthorized",
			status: 401,
			url: "https://api.openpanel.dev/track",
		});
	});
});
