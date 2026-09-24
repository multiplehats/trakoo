import { PostHogServerProvider } from "../src/server.js";
import { describe, expect, it, vi } from "vitest";

/**
 * Exercises the real `posthog-node` client rather than a mock, so the adapter
 * compatibility matrix proves each supported SDK version still delivers the
 * batch PostHog expects. The SDK's own `fetch` option stands in for the
 * network.
 */
describe("PostHogServerProvider with the node SDK", () => {
	const createProvider = () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
			status: 200,
			text: async () => "{}",
			json: async () => ({}),
		}));
		const provider = new PostHogServerProvider({
			apiKey: "phc_key",
			host: "https://eu.i.posthog.com",
			fetch: fetchMock,
			disableCompression: true,
		});
		return { provider, fetchMock };
	};

	const deliveredEvents = async (fetchMock: {
		mock: { calls: [string, RequestInit][] };
	}) => {
		const events: Array<Record<string, unknown>> = [];
		for (const [url, init] of fetchMock.mock.calls) {
			expect(url).toBe("https://eu.i.posthog.com/batch/");
			const body = init.body instanceof Blob ? await init.body.text() : init.body;
			const payload = JSON.parse(String(body)) as {
				api_key: string;
				batch: Array<Record<string, unknown>>;
			};
			expect(payload.api_key).toBe("phc_key");
			events.push(...payload.batch);
		}
		return events;
	};

	it("delivers identify and track calls when shut down", async () => {
		const { provider, fetchMock } = createProvider();
		await provider.initialize();

		provider.identify("user-a", { email: "user-a@example.com" });
		provider.track(
			{
				action: "checkout_completed",
				category: "conversion",
				properties: { total: 5 },
			},
			{ user: { userId: "user-a", email: "user-a@example.com" } },
		);
		await provider.shutdown();

		const events = await deliveredEvents(fetchMock);
		expect(events).toEqual([
			expect.objectContaining({
				event: "$identify",
				distinct_id: "user-a",
				properties: expect.objectContaining({
					$set: { email: "user-a@example.com" },
				}),
			}),
			expect.objectContaining({
				event: "checkout_completed",
				distinct_id: "user-a",
				properties: expect.objectContaining({
					total: 5,
					category: "conversion",
					user_email: "user-a@example.com",
				}),
			}),
		]);
	});
});
