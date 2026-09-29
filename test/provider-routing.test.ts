/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAnalyticsProvider } from "./mock-provider";
import { createClientAnalytics } from "@/client";
import { defineEvents, noProperties, typed } from "@/core/events";
import { createServerAnalytics } from "@/server";
import type { BrowserAnalytics } from "@/adapters/client/browser-analytics";
import type { ServerAnalytics } from "@/adapters/server/server-analytics";

// Mock window.location for client tests
Object.defineProperty(window, "location", {
	value: {
		pathname: "/test-page",
		href: "http://localhost:3000/test-page",
	},
	writable: true,
});

const clientRoutingEvents = defineEvents({
	testEvent: {
		name: "test_event",
		category: "engagement",
		properties: typed<{ foo: string }>(),
	},
	newsletterSignup: {
		name: "newsletter_signup",
		category: "conversion",
		properties: typed<{ email: string }>(),
	},
	newsletterUnsubscribe: {
		name: "newsletter_unsubscribe",
		category: "conversion",
		properties: typed<{ email: string }>(),
	},
	userRegistered: {
		name: "user_registered",
		category: "user",
		properties: typed<{ userId: string }>(),
	},
	pageViewed: {
		name: "page_viewed",
		category: "navigation",
		properties: typed<{ path: string }>(),
	},
	buttonClicked: {
		name: "button_clicked",
		category: "engagement",
		properties: typed<{ buttonId: string }>(),
	},
});

const adversarialRoutingEvents = defineEvents({
	billingDotPaid: {
		name: "billing.v2_paid",
		category: "conversion",
		properties: noProperties(),
	},
	billingDotPrivate: {
		name: "billingXv2_private",
		category: "conversion",
		properties: noProperties(),
	},
	featurePlusEnabled: {
		name: "feature+_enabled",
		category: "engagement",
		properties: noProperties(),
	},
	featurePlusPrivate: {
		name: "featureeee_private",
		category: "engagement",
		properties: noProperties(),
	},
	questionMark: {
		name: "question?mark",
		category: "engagement",
		properties: noProperties(),
	},
	questionMarkPrivate: {
		name: "questionXmark",
		category: "engagement",
		properties: noProperties(),
	},
	anchors: {
		name: "^private$",
		category: "engagement",
		properties: noProperties(),
	},
	anchorsPrivate: {
		name: "private",
		category: "engagement",
		properties: noProperties(),
	},
	brackets: {
		name: "literal[beta]",
		category: "engagement",
		properties: noProperties(),
	},
	bracketsPrivate: {
		name: "literalb",
		category: "engagement",
		properties: noProperties(),
	},
	parentheses: {
		name: "checkout_(new)",
		category: "conversion",
		properties: noProperties(),
	},
	parenthesesPrivate: {
		name: "checkout_new",
		category: "conversion",
		properties: noProperties(),
	},
	braces: {
		name: "order{draft}",
		category: "conversion",
		properties: noProperties(),
	},
	bracesPrivate: {
		name: "orderdraft",
		category: "conversion",
		properties: noProperties(),
	},
	pipe: {
		name: "plan|pro",
		category: "engagement",
		properties: noProperties(),
	},
	pipePrivate: {
		name: "plan",
		category: "engagement",
		properties: noProperties(),
	},
	backslash: {
		name: "path\\root",
		category: "navigation",
		properties: noProperties(),
	},
	backslashPrivate: {
		name: "pathroot",
		category: "navigation",
		properties: noProperties(),
	},
	unmatchedBracket: {
		name: "unmatched[",
		category: "engagement",
		properties: noProperties(),
	},
	unmatchedParenthesis: {
		name: "unmatched(",
		category: "engagement",
		properties: noProperties(),
	},
	unmatchedPrivate: {
		name: "unmatched",
		category: "engagement",
		properties: noProperties(),
	},
	anything: {
		name: "anything",
		category: "engagement",
		properties: noProperties(),
	},
	anythingElse: {
		name: "anything_else",
		category: "engagement",
		properties: noProperties(),
	},
	notAnything: {
		name: "not_anything",
		category: "engagement",
		properties: noProperties(),
	},
	complete: {
		name: "complete",
		category: "engagement",
		properties: noProperties(),
	},
	checkoutComplete: {
		name: "checkout_complete",
		category: "conversion",
		properties: noProperties(),
	},
	completeLater: {
		name: "complete_later",
		category: "engagement",
		properties: noProperties(),
	},
});

const metacharacterPatterns = [
	"billing.v2_*",
	"feature+_*",
	"question?mark",
	"^private$",
	"literal[beta]",
	"checkout_(new)",
	"order{draft}",
	"plan|pro",
	"path\\root",
	"unmatched[",
	"unmatched(",
];

const metacharacterEventNames = [
	"billing.v2_paid",
	"billingXv2_private",
	"feature+_enabled",
	"featureeee_private",
	"question?mark",
	"questionXmark",
	"^private$",
	"private",
	"literal[beta]",
	"literalb",
	"checkout_(new)",
	"checkout_new",
	"order{draft}",
	"orderdraft",
	"plan|pro",
	"plan",
	"path\\root",
	"pathroot",
	"unmatched[",
	"unmatched(",
	"unmatched",
] as const;

const expectedLiteralMatches = [
	"billing.v2_paid",
	"feature+_enabled",
	"question?mark",
	"^private$",
	"literal[beta]",
	"checkout_(new)",
	"order{draft}",
	"plan|pro",
	"path\\root",
	"unmatched[",
	"unmatched(",
];

const wildcardEventNames = [
	"anything",
	"anything_else",
	"not_anything",
	"complete",
	"checkout_complete",
	"complete_later",
] as const;

describe("Provider Routing - Client", () => {
	let provider1: MockAnalyticsProvider;
	let provider2: MockAnalyticsProvider;
	let provider3: MockAnalyticsProvider;
	let analytics: BrowserAnalytics<typeof clientRoutingEvents>;

	beforeEach(() => {
		provider1 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider2 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider3 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider1.name = "Provider1";
		provider2.name = "Provider2";
		provider3.name = "Provider3";
	});

	afterEach(() => {
		provider1.clearCalls();
		provider2.clearCalls();
		provider3.clearCalls();
	});

	it("should call all methods on simple provider (default behavior)", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [provider1],
		});

		await analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();
		analytics.pageLeave();
		analytics.reset();

		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.pageView).toHaveLength(1);
		expect(provider1.calls.pageLeave).toHaveLength(1);
		expect(provider1.calls.reset).toBe(1);
	});

	it("should only call specified methods with 'methods' option", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					methods: ["track", "identify"],
				},
			],
		});

		await analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();
		analytics.pageLeave();
		analytics.reset();

		// Should call
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);

		// Should NOT call
		expect(provider1.calls.pageView).toHaveLength(0);
		expect(provider1.calls.pageLeave).toHaveLength(0);
		expect(provider1.calls.reset).toBe(0);
	});

	it("should skip specified methods with 'exclude' option", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					exclude: ["pageView", "pageLeave"],
				},
			],
		});

		await analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();
		analytics.pageLeave();
		analytics.reset();

		// Should call
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.reset).toBe(1);

		// Should NOT call
		expect(provider1.calls.pageView).toHaveLength(0);
		expect(provider1.calls.pageLeave).toHaveLength(0);
	});

	it("should handle mixed provider configurations", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				// Simple provider - gets all methods
				provider1,
				// Only track and identify
				{
					provider: provider2,
					methods: ["track", "identify"],
				},
				// Everything except pageView
				{
					provider: provider3,
					exclude: ["pageView"],
				},
			],
		});

		await analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();
		analytics.pageLeave();
		analytics.reset();

		// Provider 1 - all methods
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.pageView).toHaveLength(1);
		expect(provider1.calls.pageLeave).toHaveLength(1);
		expect(provider1.calls.reset).toBe(1);

		// Provider 2 - only track and identify
		expect(provider2.calls.initialize).toBe(1);
		expect(provider2.calls.identify).toHaveLength(1);
		expect(provider2.calls.track).toHaveLength(1);
		expect(provider2.calls.pageView).toHaveLength(0);
		expect(provider2.calls.pageLeave).toHaveLength(0);
		expect(provider2.calls.reset).toBe(0);

		// Provider 3 - all except pageView
		expect(provider3.calls.initialize).toBe(1);
		expect(provider3.calls.identify).toHaveLength(1);
		expect(provider3.calls.track).toHaveLength(1);
		expect(provider3.calls.pageView).toHaveLength(0);
		expect(provider3.calls.pageLeave).toHaveLength(1);
		expect(provider3.calls.reset).toBe(1);
	});

	it("should prefer 'methods' over 'exclude' when both are specified", async () => {
		// Mock console.warn to capture the warning
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					methods: ["track"],
					exclude: ["pageView"], // Should be ignored
				},
			],
		});

		await analytics.initialize();
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();

		// Should use 'methods' config
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.pageView).toHaveLength(0);

		// Should warn about conflicting config
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("both 'methods' and 'exclude'"),
		);

		warnSpy.mockRestore();
	});

	it("should handle empty 'methods' array", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					methods: [],
				},
			],
		});

		await analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();

		// Initialize is always called, but no other methods
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(0);
		expect(provider1.calls.track).toHaveLength(0);
		expect(provider1.calls.pageView).toHaveLength(0);
	});

	it("should handle empty 'exclude' array", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					exclude: [],
				},
			],
		});

		await analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();

		// All methods should be called
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.pageView).toHaveLength(1);
	});
});

describe("Provider Routing - Server", () => {
	let provider1: MockAnalyticsProvider;
	let provider2: MockAnalyticsProvider;
	let provider3: MockAnalyticsProvider;
	let analytics: ServerAnalytics<typeof clientRoutingEvents>;

	beforeEach(() => {
		provider1 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider2 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider3 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider1.name = "Provider1";
		provider2.name = "Provider2";
		provider3.name = "Provider3";
	});

	afterEach(() => {
		provider1.clearCalls();
		provider2.clearCalls();
		provider3.clearCalls();
	});

	it("should call all methods on simple provider (default behavior)", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [provider1],
		});

		analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();
		analytics.pageLeave();

		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.pageView).toHaveLength(1);
		expect(provider1.calls.pageLeave).toHaveLength(1);
	});

	it("should only call specified methods with 'methods' option", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					methods: ["track", "identify"],
				},
			],
		});

		analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();
		analytics.pageLeave();

		// Should call
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);

		// Should NOT call
		expect(provider1.calls.pageView).toHaveLength(0);
		expect(provider1.calls.pageLeave).toHaveLength(0);
	});

	it("should skip specified methods with 'exclude' option", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					exclude: ["pageView", "pageLeave"],
				},
			],
		});

		analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();
		analytics.pageLeave();

		// Should call
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);

		// Should NOT call
		expect(provider1.calls.pageView).toHaveLength(0);
		expect(provider1.calls.pageLeave).toHaveLength(0);
	});

	it("should handle mixed provider configurations", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				// Simple provider - gets all methods
				provider1,
				// Only track and identify
				{
					provider: provider2,
					methods: ["track", "identify"],
				},
				// Everything except pageView
				{
					provider: provider3,
					exclude: ["pageView"],
				},
			],
		});

		analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("test_event", { foo: "bar" });
		analytics.pageView();
		analytics.pageLeave();

		// Provider 1 - all methods
		expect(provider1.calls.initialize).toBe(1);
		expect(provider1.calls.identify).toHaveLength(1);
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.pageView).toHaveLength(1);
		expect(provider1.calls.pageLeave).toHaveLength(1);

		// Provider 2 - only track and identify
		expect(provider2.calls.initialize).toBe(1);
		expect(provider2.calls.identify).toHaveLength(1);
		expect(provider2.calls.track).toHaveLength(1);
		expect(provider2.calls.pageView).toHaveLength(0);
		expect(provider2.calls.pageLeave).toHaveLength(0);

		// Provider 3 - all except pageView
		expect(provider3.calls.initialize).toBe(1);
		expect(provider3.calls.identify).toHaveLength(1);
		expect(provider3.calls.track).toHaveLength(1);
		expect(provider3.calls.pageView).toHaveLength(0);
		expect(provider3.calls.pageLeave).toHaveLength(1);
	});
});

describe("Event-Level Routing - Client", () => {
	let provider1: MockAnalyticsProvider;
	let provider2: MockAnalyticsProvider;
	let provider3: MockAnalyticsProvider;
	let analytics: BrowserAnalytics<typeof clientRoutingEvents>;

	beforeEach(() => {
		provider1 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider2 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider3 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider1.name = "Provider1";
		provider2.name = "Provider2";
		provider3.name = "Provider3";
	});

	afterEach(() => {
		provider1.clearCalls();
		provider2.clearCalls();
		provider3.clearCalls();
	});

	it("should only track whitelisted events with 'events' option", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					events: ["newsletter_signup", "user_registered"],
				},
			],
		});

		await analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("user_registered", { userId: "123" });
		await analytics.track("page_viewed", { path: "/home" });
		await analytics.track("button_clicked", { buttonId: "cta" });

		// Should only track whitelisted events
		expect(provider1.calls.track).toHaveLength(2);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider1.calls.track[1].event.action).toBe("user_registered");
	});

	it("should exclude events with 'excludeEvents' option", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					excludeEvents: ["page_viewed"],
				},
			],
		});

		await analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("user_registered", { userId: "123" });
		await analytics.track("page_viewed", { path: "/home" });
		await analytics.track("button_clicked", { buttonId: "cta" });

		// Should track all events except blacklisted ones
		expect(provider1.calls.track).toHaveLength(3);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider1.calls.track[1].event.action).toBe("user_registered");
		expect(provider1.calls.track[2].event.action).toBe("button_clicked");
	});

	it("should match events with 'eventPatterns' glob patterns", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					eventPatterns: ["newsletter_*", "user_registered"],
				},
			],
		});

		await analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("newsletter_unsubscribe", {
			email: "test@example.com",
		});
		await analytics.track("user_registered", { userId: "123" });
		await analytics.track("page_viewed", { path: "/home" });
		await analytics.track("button_clicked", { buttonId: "cta" });

		// Should match patterns
		expect(provider1.calls.track).toHaveLength(3);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider1.calls.track[1].event.action).toBe(
			"newsletter_unsubscribe",
		);
		expect(provider1.calls.track[2].event.action).toBe("user_registered");
	});

	it("treats regex metacharacters literally without leaking non-matching events", async () => {
		const literalProvider = new MockAnalyticsProvider();
		const metacharacterAnalytics = createClientAnalytics({
			events: adversarialRoutingEvents,
			providers: [
				{
					provider: literalProvider,
					eventPatterns: metacharacterPatterns,
				},
			],
		});

		await metacharacterAnalytics.initialize();
		for (const eventName of metacharacterEventNames) {
			await metacharacterAnalytics.track(eventName);
		}

		expect(
			literalProvider.calls.track.map(({ event }) => event.action),
		).toEqual(expectedLiteralMatches);
	});

	it("keeps wildcard routing anchored for wildcard-only, prefix, and suffix patterns", async () => {
		const prefixProvider = new MockAnalyticsProvider();
		const suffixProvider = new MockAnalyticsProvider();
		const wildcardProvider = new MockAnalyticsProvider();
		const wildcardAnalytics = createClientAnalytics({
			events: adversarialRoutingEvents,
			providers: [
				{ provider: prefixProvider, eventPatterns: ["anything*"] },
				{ provider: suffixProvider, eventPatterns: ["*complete"] },
				{ provider: wildcardProvider, eventPatterns: ["*"] },
			],
		});

		await wildcardAnalytics.initialize();
		for (const eventName of wildcardEventNames) {
			await wildcardAnalytics.track(eventName);
		}

		expect(prefixProvider.calls.track.map(({ event }) => event.action)).toEqual(
			["anything", "anything_else"],
		);
		expect(suffixProvider.calls.track.map(({ event }) => event.action)).toEqual(
			["complete", "checkout_complete"],
		);
		expect(
			wildcardProvider.calls.track.map(({ event }) => event.action),
		).toEqual(wildcardEventNames);
	});

	it("rejects non-string event patterns with a stable TypeError", () => {
		let thrown: unknown;

		try {
			createClientAnalytics({
				events: adversarialRoutingEvents,
				providers: [
					{
						provider: new MockAnalyticsProvider(),
						eventPatterns: [42 as unknown as string],
					},
				],
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(TypeError);
		expect(thrown).toHaveProperty("message", "Event pattern must be a string");
	});

	it("should combine method and event routing", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					methods: ["track", "identify"],
					events: ["newsletter_signup"],
				},
			],
		});

		await analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("page_viewed", { path: "/home" });
		analytics.pageView();

		// Should call identify (allowed method, no event filtering)
		expect(provider1.calls.identify).toHaveLength(1);
		// Should call track for newsletter_signup only
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");
		// Should NOT call pageView (method excluded)
		expect(provider1.calls.pageView).toHaveLength(0);
	});

	it("should handle real-world use case: EmitKit for specific events", async () => {
		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				// All events go to PostHog
				provider1,
				// Only newsletter events go to EmitKit
				{
					provider: provider2,
					events: ["newsletter_signup"],
					methods: ["track"],
				},
			],
		});

		await analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("user_registered", { userId: "123" });
		analytics.identify("user-123");

		// Provider1 (PostHog) - all events and methods
		expect(provider1.calls.track).toHaveLength(2);
		expect(provider1.calls.identify).toHaveLength(1);

		// Provider2 (EmitKit) - only newsletter_signup, only track
		expect(provider2.calls.track).toHaveLength(1);
		expect(provider2.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider2.calls.identify).toHaveLength(0);
	});

	it("should prefer 'events' over 'excludeEvents' when both are specified", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					events: ["newsletter_signup"],
					excludeEvents: ["page_viewed"], // Should be ignored
				},
			],
		});

		await analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("page_viewed", { path: "/home" });

		// Should use 'events' config
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");

		// Should warn about conflicting config
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("both 'events' and 'excludeEvents'"),
		);

		warnSpy.mockRestore();
	});
});

describe("Event-Level Routing - Server", () => {
	let provider1: MockAnalyticsProvider;
	let provider2: MockAnalyticsProvider;
	let provider3: MockAnalyticsProvider;
	let analytics: ServerAnalytics<typeof clientRoutingEvents>;

	beforeEach(() => {
		provider1 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider2 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider3 = new MockAnalyticsProvider({ debug: false, enabled: true });
		provider1.name = "Provider1";
		provider2.name = "Provider2";
		provider3.name = "Provider3";
	});

	afterEach(() => {
		provider1.clearCalls();
		provider2.clearCalls();
		provider3.clearCalls();
	});

	it("should only track whitelisted events with 'events' option", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					events: ["newsletter_signup", "user_registered"],
				},
			],
		});

		analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("user_registered", { userId: "123" });
		await analytics.track("page_viewed", { path: "/home" });
		await analytics.track("button_clicked", { buttonId: "cta" });

		// Should only track whitelisted events
		expect(provider1.calls.track).toHaveLength(2);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider1.calls.track[1].event.action).toBe("user_registered");
	});

	it("should exclude events with 'excludeEvents' option", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					excludeEvents: ["page_viewed"],
				},
			],
		});

		analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("user_registered", { userId: "123" });
		await analytics.track("page_viewed", { path: "/home" });
		await analytics.track("button_clicked", { buttonId: "cta" });

		// Should track all events except blacklisted ones
		expect(provider1.calls.track).toHaveLength(3);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider1.calls.track[1].event.action).toBe("user_registered");
		expect(provider1.calls.track[2].event.action).toBe("button_clicked");
	});

	it("should match events with 'eventPatterns' glob patterns", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					eventPatterns: ["newsletter_*", "user_registered"],
				},
			],
		});

		analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("newsletter_unsubscribe", {
			email: "test@example.com",
		});
		await analytics.track("user_registered", { userId: "123" });
		await analytics.track("page_viewed", { path: "/home" });
		await analytics.track("button_clicked", { buttonId: "cta" });

		// Should match patterns
		expect(provider1.calls.track).toHaveLength(3);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider1.calls.track[1].event.action).toBe(
			"newsletter_unsubscribe",
		);
		expect(provider1.calls.track[2].event.action).toBe("user_registered");
	});

	it("treats regex metacharacters literally without leaking non-matching events", async () => {
		const literalProvider = new MockAnalyticsProvider();
		const metacharacterAnalytics = createServerAnalytics({
			events: adversarialRoutingEvents,
			providers: [
				{
					provider: literalProvider,
					eventPatterns: metacharacterPatterns,
				},
			],
		});

		await metacharacterAnalytics.initialize();
		for (const eventName of metacharacterEventNames) {
			await metacharacterAnalytics.track(eventName);
		}

		expect(
			literalProvider.calls.track.map(({ event }) => event.action),
		).toEqual(expectedLiteralMatches);
	});

	it("keeps wildcard routing anchored for wildcard-only, prefix, and suffix patterns", async () => {
		const prefixProvider = new MockAnalyticsProvider();
		const suffixProvider = new MockAnalyticsProvider();
		const wildcardProvider = new MockAnalyticsProvider();
		const wildcardAnalytics = createServerAnalytics({
			events: adversarialRoutingEvents,
			providers: [
				{ provider: prefixProvider, eventPatterns: ["anything*"] },
				{ provider: suffixProvider, eventPatterns: ["*complete"] },
				{ provider: wildcardProvider, eventPatterns: ["*"] },
			],
		});

		await wildcardAnalytics.initialize();
		for (const eventName of wildcardEventNames) {
			await wildcardAnalytics.track(eventName);
		}

		expect(prefixProvider.calls.track.map(({ event }) => event.action)).toEqual(
			["anything", "anything_else"],
		);
		expect(suffixProvider.calls.track.map(({ event }) => event.action)).toEqual(
			["complete", "checkout_complete"],
		);
		expect(
			wildcardProvider.calls.track.map(({ event }) => event.action),
		).toEqual(wildcardEventNames);
	});

	it("rejects non-string event patterns with a stable TypeError", () => {
		let thrown: unknown;

		try {
			createServerAnalytics({
				events: adversarialRoutingEvents,
				providers: [
					{
						provider: new MockAnalyticsProvider(),
						eventPatterns: [42 as unknown as string],
					},
				],
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(TypeError);
		expect(thrown).toHaveProperty("message", "Event pattern must be a string");
	});

	it("should combine method and event routing", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				{
					provider: provider1,
					methods: ["track", "identify"],
					events: ["newsletter_signup"],
				},
			],
		});

		analytics.initialize();
		analytics.identify("user-123");
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("page_viewed", { path: "/home" });
		analytics.pageView();

		// Should call identify (allowed method, no event filtering)
		expect(provider1.calls.identify).toHaveLength(1);
		// Should call track for newsletter_signup only
		expect(provider1.calls.track).toHaveLength(1);
		expect(provider1.calls.track[0].event.action).toBe("newsletter_signup");
		// Should NOT call pageView (method excluded)
		expect(provider1.calls.pageView).toHaveLength(0);
	});

	it("should handle real-world use case: EmitKit for specific events only", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				// All events go to PostHog
				provider1,
				// Only newsletter events go to EmitKit
				{
					provider: provider2,
					events: ["newsletter_signup"],
					methods: ["track"],
				},
			],
		});

		analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("user_registered", { userId: "123" });
		analytics.identify("user-123");

		// Provider1 (PostHog) - all events and methods
		expect(provider1.calls.track).toHaveLength(2);
		expect(provider1.calls.identify).toHaveLength(1);

		// Provider2 (EmitKit) - only newsletter_signup, only track
		expect(provider2.calls.track).toHaveLength(1);
		expect(provider2.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider2.calls.identify).toHaveLength(0);
	});

	it("should support complex multi-provider event routing", async () => {
		analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [
				// All events
				provider1,
				// Only newsletter events
				{
					provider: provider2,
					eventPatterns: ["newsletter_*"],
				},
				// Everything except newsletter events
				{
					provider: provider3,
					excludeEvents: ["newsletter_signup", "newsletter_unsubscribe"],
				},
			],
		});

		analytics.initialize();
		await analytics.track("newsletter_signup", { email: "test@example.com" });
		await analytics.track("user_registered", { userId: "123" });
		await analytics.track("newsletter_unsubscribe", {
			email: "test@example.com",
		});

		// Provider1 - all events
		expect(provider1.calls.track).toHaveLength(3);

		// Provider2 - only newsletter events
		expect(provider2.calls.track).toHaveLength(2);
		expect(provider2.calls.track[0].event.action).toBe("newsletter_signup");
		expect(provider2.calls.track[1].event.action).toBe(
			"newsletter_unsubscribe",
		);

		// Provider3 - all except newsletter events
		expect(provider3.calls.track).toHaveLength(1);
		expect(provider3.calls.track[0].event.action).toBe("user_registered");
	});
});

describe("Personal data routing", () => {
	const traits = {
		email: "ada@example.com",
		name: "Ada Lovelace",
		firstName: "Ada",
		lastName: "Lovelace",
		phone: "+441234567890",
		plan: "pro",
	};

	it("keeps personal traits and the user's email from a server provider with pii: false", async () => {
		const analyticsTool = new MockAnalyticsProvider({ enabled: true });
		const emailTool = new MockAnalyticsProvider({ enabled: true });
		const analytics = createServerAnalytics({
			events: clientRoutingEvents,
			providers: [{ provider: analyticsTool, pii: false }, emailTool],
		});

		await analytics.identify("user-1", traits);
		await analytics.track(
			"test_event",
			{ foo: "bar" },
			{
				userId: "user-1",
				user: { userId: "user-1", email: "ada@example.com", traits },
				context: { server: { ip: "203.0.113.7" } },
			},
		);
		await analytics.pageView(undefined, {
			context: { user: { userId: "user-1", email: "ada@example.com" } },
		});

		expect(analyticsTool.calls.identify[0]).toEqual({
			userId: "user-1",
			traits: { plan: "pro" },
		});
		expect(analyticsTool.calls.track[0].event.userId).toBe("user-1");
		expect(analyticsTool.calls.track[0].context).toEqual({
			server: { ip: "203.0.113.7" },
			user: { userId: "user-1", traits: { plan: "pro" } },
		});
		expect(analyticsTool.calls.pageView[0].context?.user).toEqual({
			userId: "user-1",
		});

		expect(emailTool.calls.identify[0].traits).toEqual(traits);
		expect(emailTool.calls.track[0].context?.user?.email).toBe(
			"ada@example.com",
		);
	});

	it("keeps personal traits from a browser provider with pii: false", async () => {
		const analyticsTool = new MockAnalyticsProvider({ enabled: true });
		const emailTool = new MockAnalyticsProvider({ enabled: true });
		const analytics = createClientAnalytics({
			events: clientRoutingEvents,
			providers: [{ provider: analyticsTool, pii: false }, emailTool],
		});
		await analytics.initialize();

		analytics.identify("user-1", traits);
		await analytics.track("test_event", { foo: "bar" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(analyticsTool.calls.identify[0].traits).toEqual({ plan: "pro" });
		expect(analyticsTool.calls.track[0].context?.user).toEqual({
			userId: "user-1",
			traits: { plan: "pro" },
		});
		expect(emailTool.calls.identify[0].traits).toEqual(traits);
		expect(emailTool.calls.track[0].context?.user?.email).toBe(
			"ada@example.com",
		);
	});
});
