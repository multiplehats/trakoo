/** @vitest-environment jsdom */
import { PostHogClientProvider } from "../src/client.js";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

/**
 * Exercises the real `posthog-js` client rather than a mock, so the adapter
 * compatibility matrix proves each supported SDK version still delivers the
 * events PostHog expects.
 */
describe("PostHogClientProvider with the web SDK", () => {
	// posthog-js keeps the `fetch` it finds when it first loads, so one stub
	// serves the whole file. Every test uses its own project token, so events
	// from another test's named SDK instance are never mistaken for its own.
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response("{}", { status: 200 }),
	);

	beforeAll(() => {
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		window.history.replaceState({}, "", "/");
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	const createProvider = async (token: string) => {
		const provider = new PostHogClientProvider({
			token,
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
		return provider;
	};

	it("delivers identify and track calls to the capture endpoint", async () => {
		const provider = await createProvider("phc_key");

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
			expect(
				captured(fetchMock, "phc_key").map((event) => event.event),
			).toEqual(["$identify", "checkout_completed"]);
		});
		const [identify, checkout] = captured(fetchMock, "phc_key");
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

	it("keeps the SDK's live page URL instead of trakoo's page snapshot", async () => {
		const provider = await createProvider("phc_url");
		// A single-page app navigated without a trakoo pageView, so the context
		// still describes the landing page.
		window.history.pushState({}, "", "/checkout?step=2");

		provider.track(
			{ action: "checkout_started", category: "conversion" },
			{ page: { path: "/landing", url: "http://localhost:3000/landing" } },
		);

		await vi.waitFor(() => {
			expect(captured(fetchMock, "phc_url")).toHaveLength(1);
		});
		const [event] = captured(fetchMock, "phc_url");
		expect(event?.properties.$current_url).toBe(window.location.href);
		expect(event?.properties.$current_url).toContain("/checkout?step=2");
	});
});

type CapturedEvent = {
	event: string;
	properties: Record<string, unknown>;
	$set?: Record<string, unknown>;
};

function captured(
	fetchMock: {
		mock: { calls: [string, RequestInit][] };
	},
	token: string,
): CapturedEvent[] {
	return fetchMock.mock.calls
		.filter(([url]) => new URL(url).pathname === "/e/")
		.flatMap(([, init]) => {
			const payload = JSON.parse(String(init.body)) as
				| CapturedEvent
				| CapturedEvent[]
				| { batch: CapturedEvent[] };
			if (Array.isArray(payload)) return payload;
			return "batch" in payload ? payload.batch : [payload];
		})
		.filter((event) => event.properties.token === token);
}
