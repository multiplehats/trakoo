import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BentoServerProvider } from "../src/server.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the real `@bentonow/bento-node-sdk` client rather than a mock, so
 * the adapter compatibility matrix proves each supported SDK version still
 * sends the requests Bento expects. SDK 0.2 bundles cross-fetch and SDK 2 uses
 * the global fetch, so a local server stands in for the Bento API instead of a
 * stubbed global.
 */
describe("BentoServerProvider with the node SDK", () => {
	let server: Server | undefined;

	afterEach(async () => {
		await new Promise((resolve) => server?.close(resolve));
		server = undefined;
		vi.restoreAllMocks();
	});

	type RecordedRequest = {
		method?: string;
		path?: string;
		authorization?: string;
		body: { site_uuid: string; events: Array<Record<string, unknown>> };
	};

	const startBentoApi = async (
		responseBody: Record<string, unknown> = { results: 1, failed: 0 },
	) => {
		const requests: RecordedRequest[] = [];
		server = createServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => {
				body += chunk;
			});
			request.on("end", () => {
				requests.push({
					method: request.method,
					path: request.url,
					authorization: request.headers.authorization,
					body: JSON.parse(body),
				});
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify(responseBody));
			});
		});
		await new Promise<void>((resolve) =>
			server?.listen(0, "127.0.0.1", resolve),
		);
		const { port } = server.address() as AddressInfo;
		return { requests, baseUrl: `http://127.0.0.1:${port}/api/v1` };
	};

	const createProvider = (baseUrl: string) =>
		new BentoServerProvider({
			siteUuid: "site-uuid",
			authentication: { publishableKey: "publishable", secretKey: "secret" },
			clientOptions: { baseUrl },
		});

	it("identifies and tracks through the Bento batch API", async () => {
		const { requests, baseUrl } = await startBentoApi();
		const provider = createProvider(baseUrl);
		await provider.initialize();

		await provider.identify("user@example.com", { plan: "pro" });
		await provider.track(
			{
				action: "checkout_completed",
				category: "conversion",
				properties: { total: 5 },
			},
			{ user: { email: "user@example.com" } },
		);

		const basicAuth = `Basic ${Buffer.from("publishable:secret").toString("base64")}`;
		expect(requests).toEqual([
			{
				method: "POST",
				path: "/api/v1/batch/events",
				authorization: basicAuth,
				body: {
					site_uuid: "site-uuid",
					events: [
						expect.objectContaining({
							type: "$update_fields",
							email: "user@example.com",
							fields: { plan: "pro" },
						}),
					],
				},
			},
			{
				method: "POST",
				path: "/api/v1/batch/events",
				authorization: basicAuth,
				body: {
					site_uuid: "site-uuid",
					events: [
						expect.objectContaining({
							type: "$checkout_completed",
							email: "user@example.com",
							details: expect.objectContaining({
								total: 5,
								category: "conversion",
							}),
						}),
					],
				},
			},
		]);
	});

	it("updates fields on identify without sending a subscribe event", async () => {
		const { requests, baseUrl } = await startBentoApi();
		const provider = createProvider(baseUrl);
		await provider.initialize();

		await provider.identify("user-123", {
			email: "user@example.com",
			plan: "pro",
		});
		await provider.identify("user@example.com");

		const events = requests.flatMap((request) => request.body.events);
		expect(events).toEqual([
			{
				type: "$update_fields",
				email: "user@example.com",
				fields: { plan: "pro" },
			},
			{ type: "$update_fields", email: "user@example.com", fields: {} },
		]);
	});

	it("sends the event timestamp as the Bento event date", async () => {
		const { requests, baseUrl } = await startBentoApi();
		const provider = createProvider(baseUrl);
		await provider.initialize();
		const timestamp = Date.UTC(2026, 0, 2, 3, 4, 5);

		await provider.track(
			{
				action: "report_exported",
				category: "engagement",
				timestamp,
				properties: {},
			},
			{ user: { email: "user@example.com" } },
		);

		expect(requests[0]?.body.events[0]).toMatchObject({
			type: "$report_exported",
			date: "2026-01-02T03:04:05.000Z",
			details: expect.objectContaining({ timestamp }),
		});
	});

	it("reports events that Bento does not queue", async () => {
		const { requests, baseUrl } = await startBentoApi({
			results: 0,
			failed: 1,
		});
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const provider = createProvider(baseUrl);
		await provider.initialize();

		await provider.identify("user@example.com", { plan: "pro" });
		await provider.track(
			{ action: "checkout_completed", category: "conversion", properties: {} },
			{ user: { email: "user@example.com" } },
		);
		await provider.pageView(
			{},
			{ user: { email: "user@example.com" }, page: { path: "/pricing" } },
		);

		expect(requests).toHaveLength(3);
		expect(errorSpy.mock.calls).toEqual([
			["[Bento-Server] Failed to identify user (not queued by Bento)"],
			["[Bento-Server] Failed to track event (not queued by Bento)"],
			["[Bento-Server] Failed to track page view (not queued by Bento)"],
		]);
	});
});
