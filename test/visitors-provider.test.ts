/**
 * @vitest-environment jsdom
 *
 * Unit tests for VisitorsClientProvider.
 *
 * All browser globals (window, document, navigator) are provided by jsdom.
 * We intercept script injection to avoid real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VisitorsClientProvider } from "@/providers/visitors/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a mock visitors SDK object */
function mockVisitorsSdk() {
	return {
		track: vi.fn(),
		identify: vi.fn(),
	};
}

/**
 * Stub document.createElement so that when a <script> is appended to
 * document.head the onload callback fires synchronously and window.visitors
 * is already available.
 */
function stubScriptLoading(sdk: ReturnType<typeof mockVisitorsSdk>) {
	const appendChildSpy = vi
		.spyOn(document.head, "appendChild")
		.mockImplementation((node) => {
			// Fire onload on the next tick so the Promise resolves properly
			if (node instanceof HTMLScriptElement && node.src.includes("visitors.now")) {
				(window as unknown as Record<string, unknown>).visitors = sdk;
				setTimeout(() => {
					node.onload?.(new Event("load"));
				}, 0);
			}
			return node;
		});

	return appendChildSpy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("VisitorsClientProvider", () => {
	let sdk: ReturnType<typeof mockVisitorsSdk>;

	beforeEach(() => {
		sdk = mockVisitorsSdk();
		// Remove any leftover window.visitors from previous tests
		Reflect.deleteProperty(window, "visitors");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ─────────────────────────────────────────────────────────────
	// Initialization
	// ─────────────────────────────────────────────────────────────
	describe("initialize()", () => {
		it("should load the visitors.now script with the correct token", async () => {
			const appendSpy = stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "test-token-123" });

			await provider.initialize();

			const scriptEl = appendSpy.mock.calls
				.map(([n]) => n)
				.find((n): n is HTMLScriptElement => n instanceof HTMLScriptElement);

			expect(scriptEl).toBeDefined();
			expect(scriptEl?.src).toContain("cdn.visitors.now");
			expect(scriptEl?.dataset.token).toBe("test-token-123");
		});

		it("should set name to 'Visitors-Client'", () => {
			const provider = new VisitorsClientProvider({ token: "t" });
			expect(provider.name).toBe("Visitors-Client");
		});

		it("should throw when token is empty string", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "" });
			await expect(provider.initialize()).rejects.toThrow("token");
		});

		it("should skip initialisation when enabled is false", async () => {
			const appendSpy = stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({
				token: "test-token",
				enabled: false,
			});

			await provider.initialize();

			const scriptInjected = appendSpy.mock.calls.some(([n]) =>
				n instanceof HTMLScriptElement && n.src.includes("visitors.now"),
			);
			expect(scriptInjected).toBe(false);
		});

		it("should be idempotent – calling initialize() twice loads script once", async () => {
			const appendSpy = stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "test-token" });

			await provider.initialize();
			await provider.initialize();

			const scriptLoads = appendSpy.mock.calls.filter(([n]) =>
				n instanceof HTMLScriptElement && n.src.includes("visitors.now"),
			).length;

			expect(scriptLoads).toBe(1);
		});

		it("should not race – concurrent initialize() calls load script exactly once", async () => {
			const appendSpy = stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "test-token" });

			// Fire three concurrent initialize() calls without awaiting between them
			await Promise.all([
				provider.initialize(),
				provider.initialize(),
				provider.initialize(),
			]);

			const scriptLoads = appendSpy.mock.calls.filter(([n]) =>
				n instanceof HTMLScriptElement && n.src.includes("visitors.now"),
			).length;

			expect(scriptLoads).toBe(1);
		});

		it("should not re-inject script when it is already in the DOM", async () => {
			// Pre-insert a script tag as if another tool already loaded it
			const existing = document.createElement("script");
			existing.src = "https://cdn.visitors.now/v.js";
			document.head.appendChild(existing);

			const appendSpy = vi.spyOn(document.head, "appendChild");
			(window as unknown as Record<string, unknown>).visitors = sdk;

			const provider = new VisitorsClientProvider({ token: "test-token" });
			await provider.initialize();

			const newScriptLoads = appendSpy.mock.calls.filter(([n]) =>
				n instanceof HTMLScriptElement && n.src.includes("cdn.visitors.now"),
			).length;
			expect(newScriptLoads).toBe(0);

			// Clean up
			document.head.removeChild(existing);
		});
	});

	// ─────────────────────────────────────────────────────────────
	// identify()
	// ─────────────────────────────────────────────────────────────
	describe("identify()", () => {
		it("should call visitors.identify() with id and scalar traits", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.identify("user-abc", {
				email: "user@example.com",
				name: "Test User",
				plan: "pro",
				seats: 3,
			});

			expect(sdk.identify).toHaveBeenCalledTimes(1);
			expect(sdk.identify).toHaveBeenCalledWith({
				id: "user-abc",
				email: "user@example.com",
				name: "Test User",
				plan: "pro",
				seats: 3,
			});
		});

		it("should filter out non-scalar trait values", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.identify("user-1", {
				email: "a@b.com",
				nested: { foo: "bar" },         // object — should be dropped
				arr: [1, 2, 3],                  // array — should be dropped
				valid: "keep",
			});

			const call = sdk.identify.mock.calls[0][0] as Record<string, unknown>;
			expect(call.email).toBe("a@b.com");
			expect(call.valid).toBe("keep");
			expect(call.nested).toBeUndefined();
			expect(call.arr).toBeUndefined();
		});

		it("should not call identify() before initialization", () => {
			const provider = new VisitorsClientProvider({ token: "t" });
			provider.identify("user-1");
			// No error, no SDK call
			expect(sdk.identify).not.toHaveBeenCalled();
		});

		it("should not call identify() when disabled", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t", enabled: false });
			await provider.initialize();
			provider.identify("user-1");
			expect(sdk.identify).not.toHaveBeenCalled();
		});

		it("should deduplicate – second identify() with same userId is a no-op", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.identify("user-abc", { email: "a@b.com" });
			provider.identify("user-abc", { email: "a@b.com" });
			provider.identify("user-abc", { email: "a@b.com" });

			expect(sdk.identify).toHaveBeenCalledTimes(1);
		});

		it("should re-identify when userId changes", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.identify("user-1", { email: "one@example.com" });
			provider.identify("user-2", { email: "two@example.com" });

			expect(sdk.identify).toHaveBeenCalledTimes(2);
			expect((sdk.identify.mock.calls[0][0] as { id: string }).id).toBe("user-1");
			expect((sdk.identify.mock.calls[1][0] as { id: string }).id).toBe("user-2");
		});
	});

	// ─────────────────────────────────────────────────────────────
	// track()
	// ─────────────────────────────────────────────────────────────
	describe("track()", () => {
		it("should call visitors.track() with event action and scalar properties", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.track({
				action: "button_clicked",
				category: "engagement",
				properties: { button: "cta", value: 42 },
			});

			expect(sdk.track).toHaveBeenCalledTimes(1);
			const [name, props] = sdk.track.mock.calls[0] as [string, Record<string, unknown>];
			expect(name).toBe("button_clicked");
			expect(props.button).toBe("cta");
			expect(props.value).toBe(42);
			expect(props.category).toBe("engagement");
		});

		it("should include page_path and page_title from context", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.track(
				{ action: "nav", category: "navigation", properties: {} },
				{ page: { path: "/dashboard", title: "Dashboard" } },
			);

			const [, props] = sdk.track.mock.calls[0] as [string, Record<string, unknown>];
			expect(props.page_path).toBe("/dashboard");
			expect(props.page_title).toBe("Dashboard");
		});

		it("should filter out non-scalar event properties", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.track({
				action: "test",
				category: "test",
				properties: {
					valid_str: "ok",
					valid_num: 7,
					nested_obj: { a: 1 },
					arr_val: [1, 2],
				},
			});

			const [, props] = sdk.track.mock.calls[0] as [string, Record<string, unknown>];
			expect(props.valid_str).toBe("ok");
			expect(props.valid_num).toBe(7);
			expect(props.nested_obj).toBeUndefined();
			expect(props.arr_val).toBeUndefined();
		});

		it("should not track before initialization", () => {
			const provider = new VisitorsClientProvider({ token: "t" });
			provider.track({ action: "test", category: "test", properties: {} });
			expect(sdk.track).not.toHaveBeenCalled();
		});

		it("should not track when disabled", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t", enabled: false });
			await provider.initialize();
			provider.track({ action: "test", category: "test", properties: {} });
			expect(sdk.track).not.toHaveBeenCalled();
		});
	});

	// ─────────────────────────────────────────────────────────────
	// pageView()
	// ─────────────────────────────────────────────────────────────
	describe("pageView()", () => {
		it("should NOT call visitors.track() — automatic tracking by script", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.pageView({ test: "page-view" });

			expect(sdk.track).not.toHaveBeenCalled();
		});
	});

	// ─────────────────────────────────────────────────────────────
	// pageLeave()
	// ─────────────────────────────────────────────────────────────
	describe("pageLeave()", () => {
		it("should call visitors.track('page_leave', ...) with scalar properties", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			provider.pageLeave(
				{ section: "hero" },
				{ page: { path: "/home" } },
			);

			expect(sdk.track).toHaveBeenCalledTimes(1);
			const [name, props] = sdk.track.mock.calls[0] as [string, Record<string, unknown>];
			expect(name).toBe("page_leave");
			expect(props.section).toBe("hero");
			expect(props.page_path).toBe("/home");
		});

		it("should not call visitors.track() before initialization", () => {
			const provider = new VisitorsClientProvider({ token: "t" });
			provider.pageLeave({ section: "footer" });
			expect(sdk.track).not.toHaveBeenCalled();
		});
	});

	// ─────────────────────────────────────────────────────────────
	// reset()
	// ─────────────────────────────────────────────────────────────
	describe("reset()", () => {
		it("should not throw and should not call any SDK method", async () => {
			stubScriptLoading(sdk);
			const provider = new VisitorsClientProvider({ token: "t" });
			await provider.initialize();

			expect(() => provider.reset()).not.toThrow();
			expect(sdk.track).not.toHaveBeenCalled();
			expect(sdk.identify).not.toHaveBeenCalled();
		});
	});

	// ─────────────────────────────────────────────────────────────
	// getVisitorId() – Stripe revenue attribution
	// ─────────────────────────────────────────────────────────────
	describe("getVisitorId()", () => {
		afterEach(() => {
			// Clear cookies set during tests
			document.cookie = "visitor=; max-age=0; path=/";
		});

		it("should return null when the visitor cookie is not set", () => {
			const provider = new VisitorsClientProvider({ token: "t" });
			expect(provider.getVisitorId()).toBeNull();
		});

		it("should return the value of the visitor cookie", () => {
			document.cookie = "visitor=abc-visitor-123; path=/";
			const provider = new VisitorsClientProvider({ token: "t" });
			expect(provider.getVisitorId()).toBe("abc-visitor-123");
		});

		it("should correctly parse the visitor cookie when multiple cookies exist", () => {
			document.cookie = "session=sess-456; path=/";
			document.cookie = "visitor=vis-789; path=/";
			document.cookie = "theme=dark; path=/";

			const provider = new VisitorsClientProvider({ token: "t" });
			expect(provider.getVisitorId()).toBe("vis-789");
		});

		it("should URL-decode the visitor cookie value", () => {
			document.cookie = `visitor=${encodeURIComponent("id with spaces")}; path=/`;
			const provider = new VisitorsClientProvider({ token: "t" });
			expect(provider.getVisitorId()).toBe("id with spaces");
		});
	});

	// ─────────────────────────────────────────────────────────────
	// Export surface
	// ─────────────────────────────────────────────────────────────
	describe("exports", () => {
		it("should be exported from @/providers/client", async () => {
			const mod = await import("@/providers/client.js");
			expect((mod as Record<string, unknown>).VisitorsClientProvider).toBe(
				VisitorsClientProvider,
			);
		});

		it("should export VisitorsClientConfig type (config shape is validated at runtime)", async () => {
			// Config is a TypeScript type – verify the runtime path is correct
			// by constructing with a minimal valid config
			const provider = new VisitorsClientProvider({ token: "shape-check" });
			expect(provider).toBeInstanceOf(VisitorsClientProvider);
		});
	});
});
