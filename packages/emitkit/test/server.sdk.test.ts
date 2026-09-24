import { EmitKitServerProvider } from "../src/server.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the real `@emitkit/js` client rather than a mock, so the adapter
 * compatibility matrix proves each supported SDK version still produces the
 * requests EmitKit expects.
 */
describe("EmitKitServerProvider with the EmitKit SDK", () => {
	afterEach(() => {
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
				{ action: "checkout_completed", category: "conversion", properties: {} },
				{ user: { userId: "user-a" } },
			),
		).rejects.toThrow();
		errorSpy.mockRestore();
	});
});
