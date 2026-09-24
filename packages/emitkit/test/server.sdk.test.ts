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
		(fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
			([url, init]) => ({
				url,
				method: init.method,
				authorization: new Headers(init.headers).get("Authorization"),
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
				user_id: "user-a",
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
			user_id: "user-a",
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
			user_id: "user-b",
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

	it("keeps tags and description within EmitKit's limits instead of losing the event", async () => {
		const fetchMock = stubFetch();
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		const longTag = "t".repeat(51);
		const rawTags = [
			"conversion",
			longTag,
			...Array.from({ length: 25 }, (_, index) => `tag-${index}`),
		];
		const rawDescription = `${"d".repeat(4999)}😀`;
		await provider.track({
			action: "checkout_completed",
			category: "conversion",
			properties: { tags: rawTags, description: rawDescription },
		});

		const [{ body }] = requests(fetchMock);
		expect(body.tags).toEqual([
			"conversion",
			...Array.from({ length: 19 }, (_, index) => `tag-${index}`),
		]);
		// The emoji would straddle the limit, so it is dropped whole.
		expect(body.description).toBe("d".repeat(4999));
		expect(body.metadata.tags).toEqual(rawTags);
		expect(body.metadata.description).toBe(rawDescription);
	});

	it("times out after the documented 5 second default", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener("abort", () =>
							reject(
								Object.assign(new Error("aborted"), { name: "AbortError" }),
							),
						);
					}),
			),
		);
		const provider = new EmitKitServerProvider({ apiKey: "emitkit_key" });
		await provider.initialize();

		let settled = false;
		const outcome = provider
			.track({ action: "checkout_completed", category: "conversion" })
			.then(
				() => "resolved",
				(error: unknown) => error,
			)
			.finally(() => {
				settled = true;
			});

		await vi.advanceTimersByTimeAsync(4999);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toBe(true);
		await expect(outcome).resolves.toMatchObject({
			name: "EmitKitError",
			statusCode: 408,
		});
	});

	it("logs the EmitKit status code without the response body or API key", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							success: false,
							error: "Rate limit exceeded for user-a@example.com",
							requestId: "req-429",
						}),
						{
							status: 429,
							headers: {
								"content-type": "application/json",
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
			"[EmitKit-Server] Failed to track page view (RateLimitError 429 request req-429)",
			"[EmitKit-Server] Failed to identify user (RateLimitError 429 request req-429)",
		]);
		expect(logged.join("\n")).not.toContain("emitkit_key");
		expect(logged.join("\n")).not.toContain("example.com");
	});
});
