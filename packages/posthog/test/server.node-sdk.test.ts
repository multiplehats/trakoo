import { PostHogServerProvider } from "../src/server.js";
import type { PostHogOptions } from "../src/server.js";
import { describe, expect, it, vi } from "vitest";

/**
 * Exercises the real `posthog-node` client rather than a mock, so the adapter
 * compatibility matrix proves each supported SDK version still delivers the
 * batch PostHog expects. The SDK's own `fetch` option stands in for the
 * network.
 */
describe("PostHogServerProvider with the node SDK", () => {
	const createProvider = (
		options: Partial<PostHogOptions> = { host: "https://eu.i.posthog.com" },
	) => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
			status: 200,
			text: async () => "{}",
			json: async () => ({}),
		}));
		const provider = new PostHogServerProvider({
			apiKey: "phc_key",
			fetch: fetchMock,
			disableCompression: true,
			...options,
		});
		return { provider, fetchMock };
	};

	const deliveredEvents = async (
		fetchMock: {
			mock: { calls: [string, RequestInit][] };
		},
		batchUrl = "https://eu.i.posthog.com/batch/",
	) => {
		const events: Array<Record<string, unknown>> = [];
		for (const [url, init] of fetchMock.mock.calls) {
			expect(url).toBe(batchUrl);
			const body =
				init.body instanceof Blob ? await init.body.text() : init.body;
			const payload = JSON.parse(String(body)) as {
				api_key: string;
				batch: Array<Record<string, unknown>>;
			};
			expect(payload.api_key).toBe("phc_key");
			events.push(...payload.batch);
		}
		return events;
	};

	const propertiesOf = (event: Record<string, unknown> | undefined) =>
		(event?.properties ?? {}) as Record<string, unknown>;

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
		expect(propertiesOf(events[1])).not.toHaveProperty(
			"$process_person_profile",
		);
	});

	it("sends to PostHog's US ingestion host when no host is configured", async () => {
		const { provider, fetchMock } = createProvider({});
		await provider.initialize();

		provider.track(
			{ action: "signup_started", category: "conversion" },
			{ user: { userId: "user-a" } },
		);
		await provider.shutdown();

		const events = await deliveredEvents(
			fetchMock,
			"https://us.i.posthog.com/batch/",
		);
		expect(events).toEqual([
			expect.objectContaining({ event: "signup_started" }),
		]);
	});

	it("records the event's own time as the PostHog event timestamp", async () => {
		const { provider, fetchMock } = createProvider();
		await provider.initialize();

		provider.track(
			{
				action: "invoice_paid",
				category: "conversion",
				timestamp: Date.UTC(2024, 0, 2, 3, 4, 5),
			},
			{ user: { userId: "user-a" } },
		);
		await provider.shutdown();

		const [event] = await deliveredEvents(fetchMock);
		expect(event?.timestamp).toBe("2024-01-02T03:04:05.000Z");
		expect(propertiesOf(event)).not.toHaveProperty("timestamp");
	});

	it("keeps anonymous events apart and out of person profiles", async () => {
		const { provider, fetchMock } = createProvider();
		await provider.initialize();

		provider.track({ action: "pricing_viewed", category: "navigation" });
		provider.track({ action: "pricing_viewed", category: "navigation" });
		provider.pageView({ section: "home" });
		await provider.shutdown();

		const events = await deliveredEvents(fetchMock);
		expect(events).toHaveLength(3);
		const distinctIds = events.map((event) => event.distinct_id);
		for (const distinctId of distinctIds) {
			expect(distinctId).toEqual(expect.any(String));
			expect(distinctId).not.toBe("anonymous");
		}
		expect(new Set(distinctIds).size).toBe(3);
		for (const event of events) {
			expect(propertiesOf(event).$process_person_profile).toBe(false);
		}
	});

	it("attributes the visitor's IP, user agent, URL, and campaign to the event", async () => {
		const { provider, fetchMock } = createProvider();
		await provider.initialize();

		provider.track(
			{ action: "checkout_completed", category: "conversion" },
			{
				user: { userId: "user-a" },
				page: {
					path: "/checkout",
					url: "https://shop.example.com/checkout?step=2",
				},
				device: { type: "mobile" },
				utm: { source: "newsletter", medium: "email", name: "spring" },
				server: { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Visitor)" },
			},
		);
		provider.pageView(
			{ section: "docs" },
			{
				page: { path: "/docs", url: "https://shop.example.com/docs" },
				server: { ip: "203.0.113.8", userAgent: "Mozilla/5.0 (Reader)" },
			},
		);
		await provider.shutdown();

		const [track, pageView] = await deliveredEvents(fetchMock);
		expect(propertiesOf(track)).toMatchObject({
			$ip: "203.0.113.7",
			$raw_user_agent: "Mozilla/5.0 (Visitor)",
			$current_url: "https://shop.example.com/checkout?step=2",
			utm_source: "newsletter",
			utm_medium: "email",
			utm_campaign: "spring",
			device: { type: "mobile" },
		});
		expect(propertiesOf(pageView)).toMatchObject({
			$ip: "203.0.113.8",
			$raw_user_agent: "Mozilla/5.0 (Reader)",
			$current_url: "https://shop.example.com/docs",
			section: "docs",
		});
		// The SDK disables GeoIP by default because it would locate the server.
		// A forwarded visitor IP is what PostHog should locate instead.
		expect(propertiesOf(track)).not.toHaveProperty("$geoip_disable");
		expect(propertiesOf(pageView)).not.toHaveProperty("$geoip_disable");
	});

	it("moves a device IP to $ip instead of storing it inside device", async () => {
		const { provider, fetchMock } = createProvider();
		await provider.initialize();

		provider.track(
			{ action: "checkout_completed", category: "conversion" },
			{
				user: { userId: "user-a" },
				device: {
					type: "desktop",
					ip: "198.51.100.4",
					userAgent: "Mozilla/5.0 (Device)",
				},
			},
		);
		await provider.shutdown();

		const [event] = await deliveredEvents(fetchMock);
		expect(propertiesOf(event)).toMatchObject({
			$ip: "198.51.100.4",
			$raw_user_agent: "Mozilla/5.0 (Device)",
		});
		expect(propertiesOf(event).device).toEqual({
			type: "desktop",
			userAgent: "Mozilla/5.0 (Device)",
		});
	});

	it("keeps GeoIP off for a forwarded IP when disableGeoip is configured", async () => {
		const { provider, fetchMock } = createProvider({
			host: "https://eu.i.posthog.com",
			disableGeoip: true,
		});
		await provider.initialize();

		provider.track(
			{ action: "checkout_completed", category: "conversion" },
			{ user: { userId: "user-a" }, server: { ip: "203.0.113.7" } },
		);
		await provider.shutdown();

		const [event] = await deliveredEvents(fetchMock);
		expect(propertiesOf(event)).toMatchObject({
			$ip: "203.0.113.7",
			$geoip_disable: true,
		});
	});

	it("leaves GeoIP off for events without a visitor IP", async () => {
		const { provider, fetchMock } = createProvider();
		await provider.initialize();

		provider.track(
			{ action: "report_generated", category: "engagement" },
			{ user: { userId: "user-a" } },
		);
		await provider.shutdown();

		const [event] = await deliveredEvents(fetchMock);
		expect(propertiesOf(event)).toMatchObject({ $geoip_disable: true });
		expect(propertiesOf(event)).not.toHaveProperty("$ip");
	});
});
