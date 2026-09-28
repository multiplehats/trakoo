import { EmitKitServerProvider } from "../src/server.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the real `@emitkit/js` client rather than a mock, so the adapter
 * compatibility matrix proves each supported SDK version still produces the
 * requests EmitKit expects.
 */
describe("EmitKitServerProvider with the EmitKit SDK", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const stubFetch = () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ success: true, data: { id: "id-1" } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	};

	const requests = (fetchMock: ReturnType<typeof stubFetch>) =>
		(fetchMock.mock.calls as unknown as [URL | string, RequestInit][]).map(
			([url, init]) => ({
				url: String(url),
				method: init.method,
				authorization: new Headers(init.headers).get("Authorization"),
				idempotencyKey: new Headers(init.headers).get("Idempotency-Key"),
				body: JSON.parse(String(init.body)),
			}),
		);

	it("identifies and tracks through the EmitKit API", async () => {
		const fetchMock = stubFetch();
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await provider.identify("user-a", { email: "user-a@example.com" });
		await provider.track(
			{
				action: "checkout_completed",
				category: "conversion",
				properties: { total: 5 },
			},
			{ user: { userId: "user-a" } },
		);

		const [identify, event] = requests(fetchMock);
		expect(identify).toMatchObject({
			url: "https://api.emitkit.com/v1/identify",
			method: "POST",
			authorization: "Bearer emitkit_key",
			body: {
				userId: "user-a",
				properties: { email: "user-a@example.com" },
				aliases: ["user-a", "user-a@example.com"],
			},
		});
		expect(event).toMatchObject({
			url: "https://api.emitkit.com/v1/events",
			method: "POST",
			authorization: "Bearer emitkit_key",
			body: {
				title: "Checkout Completed",
				tags: ["conversion"],
				metadata: { total: 5, category: "conversion" },
				userId: "user-a",
			},
		});
	});

	it("surfaces a rejected API key instead of dropping the event", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ success: false, error: "invalid" }), {
						status: 401,
						headers: { "content-type": "application/json" },
					}),
			),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await expect(
			provider.track(
				{
					action: "checkout_completed",
					category: "conversion",
					properties: {},
				},
				{ user: { userId: "user-a" } },
			),
		).rejects.toThrow();
		errorSpy.mockRestore();
	});

	it("omits properties when identify has no traits", async () => {
		const fetchMock = stubFetch();
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await provider.identify("user-a");

		const [withoutTraits] = requests(fetchMock);
		expect(withoutTraits.body).not.toHaveProperty("properties");
		expect(withoutTraits.body).toEqual({
			userId: "user-a",
			aliases: ["user-a"],
		});
	});

	it("does not send a non-string email trait as an alias", async () => {
		const fetchMock = stubFetch();
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await provider.identify("user-b", { email: 42, plan: "pro" });

		// EmitKit rejects non-string aliases, which would fail the whole call.
		const [nonStringEmail] = requests(fetchMock);
		expect(nonStringEmail.body).toEqual({
			userId: "user-b",
			properties: { email: 42, plan: "pro" },
			aliases: ["user-b"],
		});
	});

	it("labels events with trakoo as their source", async () => {
		const fetchMock = stubFetch();
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await provider.track({
			action: "checkout_completed",
			category: "conversion",
			properties: {},
		});
		await provider.pageView();

		const [event, pageView] = requests(fetchMock);
		expect(event.body.source).toBe("trakoo");
		expect(pageView.body.source).toBe("trakoo");
	});

	it("keeps the visitor IP address out of event metadata", async () => {
		const fetchMock = stubFetch();
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		const context = {
			device: { ip: "203.0.113.7", browser: "Firefox" },
			server: { ip: "203.0.113.7", requestId: "req-1" },
		};
		await provider.track(
			{ action: "checkout_completed", category: "conversion", properties: {} },
			context,
		);
		await provider.pageView({}, context);
		await provider.track(
			{ action: "ip_only", category: "engagement", properties: {} },
			{ device: { ip: "203.0.113.7" }, server: { ip: "203.0.113.7" } },
		);

		const [event, pageView, ipOnly] = requests(fetchMock);
		for (const { body } of [event, pageView]) {
			expect(body.metadata.device).toEqual({ browser: "Firefox" });
			expect(body.metadata.server).toEqual({ requestId: "req-1" });
		}
		expect(ipOnly.body.metadata).not.toHaveProperty("device");
		expect(ipOnly.body.metadata).not.toHaveProperty("server");
		expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("203.0.113.7");
	});

	it("sends every tag once and the full description", async () => {
		const fetchMock = stubFetch();
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		const rawTags = [
			"conversion",
			"t".repeat(51),
			...Array.from({ length: 25 }, (_, index) => `tag-${index}`),
			"tag-0",
		];
		const rawDescription = "d".repeat(5001);
		await provider.track({
			action: "checkout_completed",
			category: "conversion",
			properties: { tags: rawTags, description: rawDescription },
		});

		// EmitKit limits only the stored event's total size, not these fields.
		const [{ body }] = requests(fetchMock);
		expect(body.tags).toEqual(rawTags.slice(0, -1));
		expect(body.description).toBe(rawDescription);
	});

	it("retries a failed event without recording it twice", async () => {
		vi.useFakeTimers();
		const fetchMock = stubFetch();
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ success: false, code: "internal_error" }), {
				status: 503,
				headers: { "content-type": "application/json" },
			}),
		);
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		const tracked = provider.track({
			action: "checkout_completed",
			category: "conversion",
		});
		await vi.advanceTimersByTimeAsync(1000);
		await expect(tracked).resolves.toBeUndefined();

		const [failed, retried] = requests(fetchMock);
		expect(requests(fetchMock)).toHaveLength(2);
		expect(retried.idempotencyKey).toBeTruthy();
		expect(retried.idempotencyKey).toBe(failed.idempotencyKey);
	});

	it("logs a request that keeps timing out by its error code", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const fetchMock = vi.fn(
			(_url: URL, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener("abort", () =>
						reject(init.signal?.reason),
					);
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const provider = new EmitKitServerProvider({
			apiKey: "emitkit_key",
			timeout: 10,
		});
		await provider.initialize();

		await expect(
			provider.track({ action: "checkout_completed", category: "conversion" }),
		).rejects.toMatchObject({ name: "EmitKitError", code: "timeout" });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(errorSpy.mock.calls.map((call) => call.join(" "))).toEqual([
			"[EmitKit-Server] Failed to track event (EmitKitError timeout)",
		]);
	});

	it("logs the EmitKit error code and status without the response body or API key", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							success: false,
							code: "rate_limited",
							error: "Rate limit exceeded for user-a@example.com",
							requestId: "req-429",
						}),
						{
							status: 429,
							headers: {
								"content-type": "application/json",
								// Over the SDK's 10 second limit, so it does not retry.
								"Retry-After": "60",
								"X-RateLimit-Limit": "100",
								"X-RateLimit-Remaining": "0",
								"X-RateLimit-Reset": "1733270400",
							},
						},
					),
			),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		await provider.pageView();
		await provider.identify("user-a");

		const logged = errorSpy.mock.calls.map((call) => call.join(" "));
		expect(logged).toEqual([
			"[EmitKit-Server] Failed to track page view (EmitKitError rate_limited 429 request req-429)",
			"[EmitKit-Server] Failed to identify user (EmitKitError rate_limited 429 request req-429)",
		]);
		expect(logged.join("\n")).not.toContain("emitkit_key");
		expect(logged.join("\n")).not.toContain("example.com");
	});
});
