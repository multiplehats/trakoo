/** @vitest-environment jsdom */
import { PostHogClientProvider } from "../src/client.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the real `posthog-js` client rather than a mock, so the adapter
 * compatibility matrix proves each supported SDK version still delivers the
 * events PostHog expects.
 */
describe("PostHogClientProvider with the web SDK", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("delivers identify and track calls to the capture endpoint", async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response("{}", { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const provider = new PostHogClientProvider({
			token: "phc_key",
			api_host: "https://eu.i.posthog.com",
			api_transport: "fetch",
			request_batching: false,
			disable_compression: true,
			autocapture: false,
			capture_pageview: false,
			disable_session_recording: true,
			persistence: "memory",
		});
		await provider.initialize();

		provider.identify("user-a", { email: "user-a@example.com" });
		provider.track(
			{
				action: "checkout_completed",
				category: "conversion",
				properties: { total: 5 },
			},
			{},
		);

		await vi.waitFor(() => {
			expect(captured(fetchMock).map((event) => event.event)).toEqual([
				"$identify",
				"checkout_completed",
			]);
		});
		const [identify, checkout] = captured(fetchMock);
		expect(identify).toMatchObject({
			properties: { distinct_id: "user-a" },
			$set: { email: "user-a@example.com" },
		});
		expect(checkout?.properties).toMatchObject({
			distinct_id: "user-a",
			total: 5,
			category: "conversion",
			token: "phc_key",
		});
	});
});

type CapturedEvent = {
	event: string;
	properties: Record<string, unknown>;
	$set?: Record<string, unknown>;
};

function captured(fetchMock: {
	mock: { calls: [string, RequestInit][] };
}): CapturedEvent[] {
	return fetchMock.mock.calls
		.filter(([url]) => new URL(url).pathname === "/e/")
		.flatMap(([, init]) => {
			const payload = JSON.parse(String(init.body)) as
				| CapturedEvent
				| CapturedEvent[]
				| { batch: CapturedEvent[] };
			if (Array.isArray(payload)) return payload;
			return "batch" in payload ? payload.batch : [payload];
		});
}
