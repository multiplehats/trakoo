/**
 * @vitest-environment jsdom
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { expect, expectTypeOf, beforeEach, describe, it, vi } from "vitest";
import { z } from "zod";
import type { BrowserAnalytics } from "@/adapters/client/browser-analytics";
import {
	type AnalyticsValidationError,
	defineEvents,
	noProperties,
	typed,
} from "@/core/events";
import { createClientAnalytics } from "@/client";
import {
	DeferredInitializeProvider,
	MockAnalyticsProvider,
} from "./mock-provider";

Object.defineProperty(window, "location", {
	value: {
		pathname: "/test-page",
		href: "http://localhost:3000/test-page",
	},
	writable: true,
});

interface UserTraits {
	email?: string;
	name?: string;
	plan?: "free" | "pro";
}

const events = defineEvents({
	pageViewed: {
		name: "page_viewed",
		category: "navigation",
		properties: typed<{
			path: string;
			title: string;
			referrer?: string;
		}>(),
	},
	buttonClicked: {
		name: "button_clicked",
		category: "engagement",
		properties: typed<{ buttonId: string; label: string }>(),
	},
	testEvent: {
		name: "test_event",
		category: "custom-category",
		properties: typed<{ test?: boolean; data?: string }>(),
	},
	beforeReset: {
		name: "before_reset",
		category: "user",
		properties: noProperties(),
	},
	afterReset: {
		name: "after_reset",
		category: "user",
		properties: noProperties(),
	},
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
	},
	normalized: {
		name: "normalized_event",
		category: "conversion",
		properties: z.object({ label: z.string() }).transform(({ label }) => ({
			normalizedLabel: label.trim().toLowerCase(),
		})),
	},
});

type TestAnalytics = BrowserAnalytics<typeof events, UserTraits>;

function assertClientTypes(): void {
	const analytics = createClientAnalytics({
		events,
		userTraits: typed<UserTraits>(),
	});

	expectTypeOf(analytics).toEqualTypeOf<TestAnalytics>();
	expectTypeOf(analytics.identify)
		.parameter(1)
		.toEqualTypeOf<UserTraits | undefined>();
	expectTypeOf(analytics.initialize()).toEqualTypeOf<Promise<void>>();
	expectTypeOf(analytics.identify("user-123")).toEqualTypeOf<void>();
	expectTypeOf(analytics.pageView()).toEqualTypeOf<void>();
	expectTypeOf(analytics.pageLeave()).toEqualTypeOf<void>();
	expectTypeOf(analytics.reset()).toEqualTypeOf<void>();

	analytics.track("page_viewed", {
		path: "/",
		title: "Home",
	});
	analytics.track("session_started");
	analytics.identify("user-123", { plan: "pro" });

	// @ts-expect-error unknown event names are rejected
	analytics.track("unknown_event", {});
	// @ts-expect-error properties are required for property-bearing events
	analytics.track("page_viewed");
	// @ts-expect-error missing required event property
	analytics.track("page_viewed", { path: "/" });
	// @ts-expect-error extra event properties are rejected
	analytics.track("page_viewed", { path: "/", title: "Home", extra: true });
	// @ts-expect-error propertyless events accept exactly one argument
	analytics.track("session_started", undefined);
	// @ts-expect-error inferred user traits reject unknown properties
	analytics.identify("user-123", { company: "Acme" });
}

void assertClientTypes;

describe("Client Analytics", () => {
	let mockProvider: MockAnalyticsProvider;
	let analytics: TestAnalytics;

	beforeEach(async () => {
		mockProvider = new MockAnalyticsProvider({ debug: false, enabled: true });
		analytics = createClientAnalytics({
			events,
			userTraits: typed<UserTraits>(),
			providers: [mockProvider],
			validation: { onFailure: "throw" },
			debug: false,
			enabled: true,
		});
		await analytics.initialize();
	});

	it("returns a fresh initialized instance from each factory call", async () => {
		const firstProvider = new MockAnalyticsProvider({ enabled: true });
		const secondProvider = new MockAnalyticsProvider({ enabled: true });
		const first = createClientAnalytics({ events, providers: [firstProvider] });
		const second = createClientAnalytics({
			events,
			providers: [secondProvider],
		});

		expect(first).not.toBe(second);
		await Promise.all([first.initialize(), second.initialize()]);
		expect(firstProvider.calls.initialize).toBe(1);
		expect(secondProvider.calls.initialize).toBe(1);
	});

	it("delivers identify once after provider initialization", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const pending = createClientAnalytics({
			events,
			userTraits: typed<UserTraits>(),
			providers: [provider],
		});

		pending.identify("user-pending", { plan: "pro" });
		expect(provider.calls.identify).toHaveLength(0);

		provider.resolveInitialize();
		await vi.waitFor(() => {
			expect(provider.calls.identify).toHaveLength(1);
		});
		expect(provider.calls.identify[0]).toEqual({
			userId: "user-pending",
			traits: { plan: "pro" },
		});
	});

	it("delivers page lifecycle calls once after provider initialization", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const pending = createClientAnalytics({
			events,
			providers: [provider],
		});

		pending.pageView({ phase: "pending-view" });
		pending.pageLeave({ phase: "pending-leave" });
		expect(provider.calls.pageView).toHaveLength(0);
		expect(provider.calls.pageLeave).toHaveLength(0);

		provider.resolveInitialize();
		await vi.waitFor(() => {
			expect(provider.calls.pageView).toHaveLength(1);
			expect(provider.calls.pageLeave).toHaveLength(1);
		});
		expect(provider.calls.pageView[0].properties).toEqual({
			phase: "pending-view",
		});
		expect(provider.calls.pageLeave[0].properties).toEqual({
			phase: "pending-leave",
		});
	});

	it("preserves identify and reset order while initialization is pending", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const operationOrder: string[] = [];
		const identify = provider.identify.bind(provider);
		const reset = provider.reset.bind(provider);
		provider.identify = (userId, traits) => {
			operationOrder.push("identify");
			identify(userId, traits);
		};
		provider.reset = () => {
			operationOrder.push("reset");
			reset();
		};
		const pending = createClientAnalytics({
			events,
			userTraits: typed<UserTraits>(),
			providers: [provider],
		});

		pending.identify("user-pending", { plan: "pro" });
		pending.reset();
		expect(operationOrder).toEqual([]);
		expect(provider.calls.identify).toHaveLength(0);
		expect(provider.calls.reset).toBe(0);

		provider.resolveInitialize();
		await vi.waitFor(() => {
			expect(operationOrder).toEqual(["identify", "reset"]);
		});
		expect(provider.calls.identify).toHaveLength(1);
		expect(provider.calls.reset).toBe(1);
	});

	it("shares one provider initialization across concurrent callers", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const pending = createClientAnalytics({
			events,
			providers: [provider],
		});
		let settled = false;

		const initialization = Promise.all([
			pending.initialize(),
			pending.initialize(),
		]).then(() => {
			settled = true;
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(provider.calls.initialize).toBe(1);
		expect(settled).toBe(false);

		provider.resolveInitialize();
		await initialization;
		expect(provider.calls.initialize).toBe(1);
	});

	it("retries provider initialization after a rejected attempt", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const pending = createClientAnalytics({
			events,
			providers: [provider],
		});
		const initializationError = new Error("initialization failed");

		const firstAttempt = pending.initialize();
		provider.rejectInitialize(initializationError);
		await expect(firstAttempt).rejects.toBe(initializationError);

		const retry = pending.initialize();
		const retryOutcome = retry.then(
			() => ({ status: "fulfilled" as const }),
			(error: unknown) => ({ status: "rejected" as const, error }),
		);
		expect(provider.calls.initialize).toBe(2);
		provider.resolveInitialize();
		expect(await retryOutcome).toEqual({ status: "fulfilled" });
		expect(provider.isInitialized()).toBe(true);
		errorSpy.mockRestore();
	});

	it("snapshots identity and session while initialization is pending", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const pending = createClientAnalytics({
			events,
			userTraits: typed<UserTraits>(),
			providers: [provider],
		});

		pending.identify("user-a", {
			email: "a@example.com",
			name: "User A",
			plan: "pro",
		});
		const initialSessionId = (pending as unknown as { sessionId: string })
			.sessionId;
		const firstTrack = pending.track("test_event", {
			data: "before-account-switch",
		});

		pending.reset();
		pending.identify("user-b", {
			email: "b@example.com",
			name: "User B",
			plan: "free",
		});
		provider.resolveInitialize();
		await firstTrack;

		expect(provider.calls.track[0].event).toMatchObject({
			userId: "user-a",
			sessionId: initialSessionId,
		});
		expect(provider.calls.track[0].context?.user).toEqual({
			userId: "user-a",
			email: "a@example.com",
			traits: {
				email: "a@example.com",
				name: "User A",
				plan: "pro",
			},
		});

		await pending.track("test_event", { data: "after-account-switch" });
		expect(provider.calls.track[1].event).toMatchObject({
			userId: "user-b",
		});
		expect(provider.calls.track[1].event.sessionId).not.toBe(initialSessionId);
		expect(provider.calls.track[1].context?.user).toEqual({
			userId: "user-b",
			email: "b@example.com",
			traits: {
				email: "b@example.com",
				name: "User B",
				plan: "free",
			},
		});
	});

	it("tracks registry categories with browser and session context", async () => {
		await analytics.track("page_viewed", {
			path: "/dashboard",
			title: "Dashboard",
		});

		const tracked = mockProvider.calls.track[0];
		expect(tracked.event).toMatchObject({
			action: "page_viewed",
			category: "navigation",
			properties: { path: "/dashboard", title: "Dashboard" },
		});
		expect(tracked.event.sessionId).toMatch(/^\d+-[a-z0-9]{9}$/);
		expect(tracked.context?.page?.path).toBe("/test-page");
	});

	it("uses the exact definition category instead of deriving one", async () => {
		await analytics.track("test_event", { test: true });

		expect(mockProvider.calls.track[0].event.category).toBe("custom-category");
	});

	it("identifies users with inferred ordinary-interface traits", async () => {
		analytics.identify("user-123", {
			email: "test@example.com",
			name: "Test User",
			plan: "pro",
		});
		await analytics.track("test_event", { test: true });

		expect(mockProvider.calls.identify[0]).toEqual({
			userId: "user-123",
			traits: {
				email: "test@example.com",
				name: "Test User",
				plan: "pro",
			},
		});
		expect(mockProvider.calls.track[0].event.userId).toBe("user-123");
		expect(mockProvider.calls.track[0].context?.user).toEqual({
			userId: "user-123",
			email: "test@example.com",
			traits: {
				email: "test@example.com",
				name: "Test User",
				plan: "pro",
			},
		});
	});

	it("tracks page views and updates context", async () => {
		analytics.pageView({ customProp: "value" });
		await vi.waitFor(() => {
			expect(mockProvider.calls.pageView).toHaveLength(1);
		});

		expect(mockProvider.calls.pageView[0]).toMatchObject({
			properties: { customProp: "value" },
		});
		expect(mockProvider.calls.pageView[0].context?.page?.path).toBe(
			"/test-page",
		);
	});

	it("keeps campaign parameters in the page URL it reports", async () => {
		const original = window.location;
		Object.defineProperty(window, "location", {
			value: {
				pathname: "/product",
				search: "?utm_source=landing.gallery&utm_medium=ad",
				href: "https://example.com/product?utm_source=landing.gallery&utm_medium=ad",
				host: "example.com",
				protocol: "https:",
			},
			writable: true,
		});

		try {
			analytics.pageView();
			await vi.waitFor(() => {
				expect(mockProvider.calls.pageView).toHaveLength(1);
			});

			const page = mockProvider.calls.pageView[0].context?.page;
			// Providers report `page.url` and fall back to `page.path`, so the
			// query string has to survive or every utm_* parameter is lost.
			expect(page?.url).toBe(
				"https://example.com/product?utm_source=landing.gallery&utm_medium=ad",
			);
			expect(page?.search).toBe("?utm_source=landing.gallery&utm_medium=ad");
			expect(page?.path).toBe("/product");
		} finally {
			Object.defineProperty(window, "location", {
				value: original,
				writable: true,
			});
		}
	});

	it("keeps the page URL in stored context for later events", async () => {
		const original = window.location;
		Object.defineProperty(window, "location", {
			value: {
				pathname: "/product",
				search: "?utm_source=landing.gallery",
				href: "https://example.com/product?utm_source=landing.gallery",
				host: "example.com",
				protocol: "https:",
			},
			writable: true,
		});

		try {
			analytics.pageView();
			analytics.track("button_clicked", {
				buttonId: "cta",
				label: "Start",
			});
			await vi.waitFor(() => {
				expect(mockProvider.calls.track).toHaveLength(1);
			});

			// pageView() substitutes its own local snapshot, so it would pass even
			// if updateContext dropped the field. track() and pageLeave() read the
			// stored context, which is the half that actually regressed.
			expect(mockProvider.calls.track[0].context?.page?.url).toBe(
				"https://example.com/product?utm_source=landing.gallery",
			);
		} finally {
			Object.defineProperty(window, "location", {
				value: original,
				writable: true,
			});
		}
	});

	it("merges partial page updates without erasing or staling fields", async () => {
		analytics.updateContext({
			page: {
				path: "/a",
				url: "https://example.com/a?ref=x",
				search: "?ref=x",
				title: "A",
			},
		});

		// A partial update must not erase url just by omitting it.
		analytics.updateContext({ page: { path: "/a", title: "A renamed" } });
		analytics.track("test_event", { test: true });
		await vi.waitFor(() => {
			expect(mockProvider.calls.track).toHaveLength(1);
		});
		expect(mockProvider.calls.track[0].context?.page?.url).toBe(
			"https://example.com/a?ref=x",
		);
		expect(mockProvider.calls.track[0].context?.page?.title).toBe("A renamed");

		// An empty search is a real value, not a missing one: navigating to a URL
		// with no query string must not keep the previous page's parameters.
		analytics.updateContext({
			page: { path: "/b", url: "https://example.com/b", search: "" },
		});
		analytics.track("test_event", { test: true });
		await vi.waitFor(() => {
			expect(mockProvider.calls.track).toHaveLength(2);
		});
		expect(mockProvider.calls.track[1].context?.page?.search).toBe("");
		expect(mockProvider.calls.track[1].context?.page?.url).toBe(
			"https://example.com/b",
		);
	});

	it("resets the session and clears user context", async () => {
		analytics.identify("user-123", { email: "test@example.com" });
		await analytics.track("before_reset");
		const initialSessionId = mockProvider.calls.track[0].event.sessionId;

		analytics.reset();
		await analytics.track("after_reset");

		expect(mockProvider.calls.reset).toBe(1);
		expect(mockProvider.calls.track[1].event.sessionId).not.toBe(
			initialSessionId,
		);
		expect(mockProvider.calls.track[1].event.userId).toBeUndefined();
		expect(mockProvider.calls.track[1].context?.user).toBeUndefined();
	});

	it("normalizes propertyless events to an empty properties object", async () => {
		await analytics.track("session_started");

		expect(mockProvider.calls.track[0].event.properties).toEqual({});
	});

	it("rejects an explicit undefined argument for a propertyless event", async () => {
		const runtimeAnalytics = analytics as unknown as {
			track(name: string, properties?: unknown): Promise<void>;
		};

		await expect(
			runtimeAnalytics.track("session_started", undefined),
		).rejects.toMatchObject({ code: "invalid_properties" });
		expect(mockProvider.calls.track).toHaveLength(0);
	});

	it("delivers one transformed output to every routed provider", async () => {
		const first = new MockAnalyticsProvider({ enabled: true });
		const second = new MockAnalyticsProvider({ enabled: true });
		const transformed = createClientAnalytics({
			events,
			providers: [first, second],
		});
		await transformed.initialize();

		await transformed.track("normalized_event", { label: "  CHECKOUT  " });

		expect(first.calls.track[0].event.properties).toEqual({
			normalizedLabel: "checkout",
		});
		expect(second.calls.track[0].event.properties).toBe(
			first.calls.track[0].event.properties,
		);
	});

	it("snapshots identity and timestamp before async schema validation", async () => {
		type DelayedProperties = { data: string };
		let resolveValidation!: (
			result: StandardSchemaV1.Result<DelayedProperties>,
		) => void;
		let markValidationStarted!: () => void;
		const validation = new Promise<StandardSchemaV1.Result<DelayedProperties>>(
			(resolve) => {
				resolveValidation = resolve;
			},
		);
		const validationStarted = new Promise<void>((resolve) => {
			markValidationStarted = resolve;
		});
		const controlledSchema: StandardSchemaV1<
			DelayedProperties,
			DelayedProperties
		> = {
			"~standard": {
				version: 1,
				vendor: "trakoo-test",
				validate: () => {
					markValidationStarted();
					return validation;
				},
			},
		};
		const delayedEvents = defineEvents({
			delayed: {
				name: "delayed_event",
				category: "custom-category",
				properties: controlledSchema,
			},
		});
		const provider = new MockAnalyticsProvider({ enabled: true });
		const delayed = createClientAnalytics({
			events: delayedEvents,
			userTraits: typed<UserTraits>(),
			providers: [provider],
			validation: { onFailure: "throw" },
		});
		await delayed.initialize();
		delayed.identify("user-a", {
			email: "a@example.com",
			name: "User A",
			plan: "pro",
		});

		let currentTimestamp = 1_000;
		const now = vi
			.spyOn(Date, "now")
			.mockImplementation(() => currentTimestamp);
		try {
			const firstTrack = delayed.track("delayed_event", {
				data: "before-account-switch",
			});
			await validationStarted;

			currentTimestamp = 2_000;
			const switchTimestamp = Date.now();
			delayed.reset();
			delayed.identify("user-b", {
				email: "b@example.com",
				name: "User B",
				plan: "free",
			});
			currentTimestamp = 3_000;
			resolveValidation({ value: { data: "validated" } });
			await firstTrack;

			expect(provider.calls.track[0].event.userId).toBe("user-a");
			expect(provider.calls.track[0].event.timestamp).toBeLessThanOrEqual(
				switchTimestamp,
			);
			expect(provider.calls.track[0].context?.user).toEqual({
				userId: "user-a",
				email: "a@example.com",
				traits: {
					email: "a@example.com",
					name: "User A",
					plan: "pro",
				},
			});

			await delayed.track("delayed_event", {
				data: "after-account-switch",
			});
			expect(provider.calls.track[1].event.userId).toBe("user-b");
			expect(provider.calls.track[1].context?.user).toEqual({
				userId: "user-b",
				email: "b@example.com",
				traits: {
					email: "b@example.com",
					name: "User B",
					plan: "free",
				},
			});
		} finally {
			now.mockRestore();
		}
	});

	it("drops invalid properties by default after reporting once", async () => {
		const onError = vi.fn();
		const dropped = createClientAnalytics({
			events,
			providers: [mockProvider],
			validation: { onError },
		});
		await dropped.initialize();
		const runtimeAnalytics = dropped as unknown as {
			track(name: string, properties?: unknown): Promise<void>;
		};

		await expect(
			runtimeAnalytics.track("page_viewed", null),
		).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledTimes(1);
		expect(mockProvider.calls.track).toHaveLength(0);
	});

	it("throws invalid properties when configured", async () => {
		const runtimeAnalytics = analytics as unknown as {
			track(name: string, properties?: unknown): Promise<void>;
		};

		await expect(runtimeAnalytics.track("page_viewed", null)).rejects.toEqual(
			expect.objectContaining<Partial<AnalyticsValidationError>>({
				code: "invalid_properties",
				eventName: "page_viewed",
			}),
		);
		expect(mockProvider.calls.track).toHaveLength(0);
	});

	it("short-circuits disabled invalid events before lookup and delivery", async () => {
		const provider = new MockAnalyticsProvider({ enabled: true });
		const onError = vi.fn();
		const disabled = createClientAnalytics({
			events,
			providers: [provider],
			enabled: false,
			validation: { onFailure: "throw", onError },
		});
		const runtimeAnalytics = disabled as unknown as {
			track(name: string, properties?: unknown): Promise<void>;
		};

		await expect(
			runtimeAnalytics.track("not_registered", { secret: true }),
		).resolves.toBeUndefined();
		expect(provider.calls.initialize).toBe(0);
		expect(provider.calls.track).toHaveLength(0);
		expect(onError).not.toHaveBeenCalled();
	});

	it("updates context", async () => {
		analytics.updateContext({
			utm: { source: "google", medium: "cpc", name: "summer-sale" },
		});
		await analytics.track("test_event", {});

		expect(mockProvider.calls.track[0].context?.utm).toEqual({
			source: "google",
			medium: "cpc",
			name: "summer-sale",
		});
	});

	it("flushes providers with the requested transport mode", async () => {
		await analytics.flush();
		await analytics.flush(true);

		expect(mockProvider.calls.flush).toEqual([
			{ useBeacon: false },
			{ useBeacon: true },
		]);
	});
});
