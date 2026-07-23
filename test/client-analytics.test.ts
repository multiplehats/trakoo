/**
 * @vitest-environment jsdom
 */
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
import { MockAnalyticsProvider } from "./mock-provider";

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
		properties: z
			.object({ label: z.string() })
			.transform(({ label }) => ({
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
		await analytics.initialize();

		expect(mockProvider.calls.pageView[0]).toMatchObject({
			properties: { customProp: "value" },
		});
		expect(mockProvider.calls.pageView[0].context?.page?.path).toBe(
			"/test-page",
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
