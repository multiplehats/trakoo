import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BentoServerProvider } from "../src/server.js";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Exercises the real `@bentonow/bento-node-sdk` client rather than a mock, so
 * the adapter compatibility matrix proves each supported SDK version still
 * sends the requests Bento expects. The SDK brings its own fetch
 * implementation, so a local server stands in for the Bento API instead of a
 * stubbed global.
 */
describe("BentoServerProvider with the node SDK", () => {
	let server: Server | undefined;

	afterEach(async () => {
		await new Promise((resolve) => server?.close(resolve));
		server = undefined;
	});

	type RecordedRequest = {
		method?: string;
		path?: string;
		authorization?: string;
		body: { site_uuid: string; events: Array<Record<string, unknown>> };
	};

	const startBentoApi = async () => {
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
				response.end(JSON.stringify({ results: 1, failed: 0 }));
			});
		});
		await new Promise<void>((resolve) =>
			server?.listen(0, "127.0.0.1", resolve),
		);
		const { port } = server.address() as AddressInfo;
		return { requests, baseUrl: `http://127.0.0.1:${port}/api/v1` };
	};

	it("identifies and tracks through the Bento batch API", async () => {
		const { requests, baseUrl } = await startBentoApi();
		const provider = new BentoServerProvider({
			siteUuid: "site-uuid",
			authentication: { publishableKey: "publishable", secretKey: "secret" },
			clientOptions: { baseUrl },
		});
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
							type: "$subscribe",
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
});
