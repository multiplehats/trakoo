import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { ServerAnalytics } from "@/adapters/server/server-analytics";
import {
	type AnalyticsValidationError,
	defineEvents,
	noProperties,
	typed,
} from "@/core/events";
import { createServerAnalytics } from "@/server";
import {
	DeferredInitializeProvider,
	MockAnalyticsProvider,
} from "./mock-provider";

interface UserTraits {
	email?: string;
	name?: string;
	plan?: "free" | "pro";
}

const events = defineEvents({
	userSignedUp: {
		name: "user_signed_up",
		category: "user",
		properties: typed<{
			userId: string;
			email: string;
			plan: "free" | "pro";
		}>(),
	},
	featureUsed: {
		name: "feature_used",
		category: "engagement",
		properties: typed<{ featureName: string; userId: string }>(),
	},
	testEvent: {
		name: "test_event",
		category: "custom-category",
		properties: typed<{ action?: string; data?: string }>(),
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

type TestAnalytics = ServerAnalytics<typeof events, UserTraits>;

function assertServerTypes(): void {
	const analytics = createServerAnalytics({
		events,
		userTraits: typed<UserTraits>(),
	});

	expectTypeOf(analytics).toEqualTypeOf<TestAnalytics>();
	expectTypeOf(analytics.identify)
		.parameter(1)
		.toEqualTypeOf<UserTraits | undefined>();
	expectTypeOf(analytics.initialize()).toEqualTypeOf<Promise<void>>();
	expectTypeOf(analytics.pageLeave()).toEqualTypeOf<void>();

	analytics.track("user_signed_up", {
		userId: "user_123",
		email: "user@example.com",
		plan: "pro",
	});
	analytics.track("session_started");
	analytics.track("session_started", { userId: "user_123" });
	analytics.track("session_started", { occurredAt: new Date() });
	analytics.track("test_event", {}, { occurredAt: 1_700_000_000_000 });
	analytics.identify("user_123", { plan: "pro" });

	// @ts-expect-error unknown event names are rejected
	analytics.track("unknown_event", {});
	// @ts-expect-error properties are required for property-bearing events
	analytics.track("user_signed_up");
	// @ts-expect-error missing required event property
	analytics.track("user_signed_up", { userId: "user_123" });
	// @ts-expect-error extra event properties are rejected
	analytics.track("test_event", { action: "clicked", extra: true });
	// @ts-expect-error no undefined properties placeholder
	analytics.track("session_started", undefined);
	// @ts-expect-error properties are forbidden
	analytics.track("session_started", { unexpected: true });
	// @ts-expect-error inferred user traits reject unknown properties
	analytics.identify("user_123", { company: "Acme" });
	analytics.track(
		"test_event",
		{},
		// @ts-expect-error occurredAt takes a Date or epoch milliseconds
		{ occurredAt: "2026-10-06T12:00:00Z" },
	);
}

void assertServerTypes;

describe("Server Analytics", () => {
	let mockProvider: MockAnalyticsProvider;
	let analytics: TestAnalytics;

	beforeEach(() => {
		mockProvider = new MockAnalyticsProvider({ debug: false, enabled: true });
		analytics = createServerAnalytics({
			events,
			userTraits: typed<UserTraits>(),
			providers: [mockProvider],
			validation: { onFailure: "throw" },
			debug: false,
			enabled: true,
		});
	});

	it("returns a fresh initialized instance from each factory call", () => {
		const firstProvider = new MockAnalyticsProvider({ enabled: true });
		const secondProvider = new MockAnalyticsProvider({ enabled: true });
		const first = createServerAnalytics({ events, providers: [firstProvider] });
		const second = createServerAnalytics({
			events,
			providers: [secondProvider],
		});

		expect(first).not.toBe(second);
		expect(firstProvider.calls.initialize).toBe(1);
		expect(secondProvider.calls.initialize).toBe(1);
	});

	it("delivers first-use operations once after provider initialization", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const pending = createServerAnalytics({
			events,
			userTraits: typed<UserTraits>(),
			providers: [provider],
			validation: { onFailure: "throw" },
		});

		const trackPromise = pending.track("test_event", { action: "pending" });
		const identifyPromise = pending.identify("user-pending", { plan: "pro" });
		const pageViewPromise = pending.pageView({ path: "/pending" });
		const pageLeaveResult = pending.pageLeave({ path: "/pending" });

		expect(pageLeaveResult).toBeUndefined();
		expect(provider.calls.track).toHaveLength(0);
		expect(provider.calls.identify).toHaveLength(0);
		expect(provider.calls.pageView).toHaveLength(0);
		expect(provider.calls.pageLeave).toHaveLength(0);

		provider.resolveInitialize();
		await Promise.all([trackPromise, identifyPromise, pageViewPromise]);
		await vi.waitFor(() => {
			expect(provider.calls.pageLeave).toHaveLength(1);
		});

		expect(provider.calls.track).toHaveLength(1);
		expect(provider.calls.identify).toHaveLength(1);
		expect(provider.calls.pageView).toHaveLength(1);
		expect(provider.calls.pageLeave).toHaveLength(1);
	});

	it("rejects awaited operations with the initialization error", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const pending = createServerAnalytics({
			events,
			providers: [provider],
		});
		const initializationError = new Error("initialization failed");

		const trackPromise = pending.track("test_event", {});
		provider.rejectInitialize(initializationError);

		await expect(trackPromise).rejects.toBe(initializationError);
		errorSpy.mockRestore();
	});

	it("shares one provider initialization across concurrent callers", async () => {
		const provider = new DeferredInitializeProvider({ enabled: true });
		const pending = createServerAnalytics({
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

	it("turns a synchronous provider initialization throw into a rejection", async () => {
		const provider = new MockAnalyticsProvider({ enabled: true });
		const initializationError = new Error("synchronous initialization failed");
		provider.initialize = () => {
			provider.calls.initialize++;
			throw initializationError;
		};
		const direct = new ServerAnalytics({
			events,
			providers: [provider],
		});
		let initialization!: Promise<void>;

		expect(() => {
			initialization = direct.initialize();
		}).not.toThrow();
		await expect(initialization).rejects.toBe(initializationError);
		expect(provider.calls.initialize).toBe(1);
	});

	it("returns the factory instance when provider initialization throws", async () => {
		const provider = new MockAnalyticsProvider({ enabled: true });
		const initializationError = new Error("synchronous initialization failed");
		provider.initialize = () => {
			provider.calls.initialize++;
			throw initializationError;
		};
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		let created: TestAnalytics | undefined;

		try {
			expect(() => {
				created = createServerAnalytics({
					events,
					userTraits: typed<UserTraits>(),
					providers: [provider],
				});
			}).not.toThrow();
			expect(created).toBeInstanceOf(ServerAnalytics);
			await vi.waitFor(() => {
				expect(errorSpy).toHaveBeenCalledWith(
					"[Analytics] Failed to initialize:",
					initializationError,
				);
			});
			expect(provider.calls.initialize).toBe(1);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("tracks definition categories, properties, and server options", async () => {
		await analytics.track(
			"feature_used",
			{ featureName: "export", userId: "user-123" },
			{
				userId: "user-123",
				sessionId: "session-456",
				context: { page: { path: "/api/export" } },
			},
		);

		expect(mockProvider.calls.track[0]).toMatchObject({
			event: {
				action: "feature_used",
				category: "engagement",
				properties: { featureName: "export", userId: "user-123" },
				userId: "user-123",
				sessionId: "session-456",
			},
			context: { page: { path: "/api/export" } },
		});
	});

	it("stamps the time of the call when no occurredAt is given", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			vi.setSystemTime(1_800_000_000_000);
			await analytics.track("test_event", {});
		} finally {
			vi.useRealTimers();
		}

		expect(mockProvider.calls.track[0].event.timestamp).toBe(1_800_000_000_000);
	});

	it.each([
		["a Date", new Date("2023-11-14T22:13:20.000Z")],
		["epoch milliseconds", 1_700_000_000_000],
	])(
		"delivers an event at its occurredAt given as %s",
		async (_label, occurredAt) => {
			await analytics.track("test_event", {}, { occurredAt });
			await analytics.track("session_started", { occurredAt });

			expect(mockProvider.calls.track.map(({ event }) => event)).toEqual([
				expect.objectContaining({
					action: "test_event",
					timestamp: 1_700_000_000_000,
				}),
				expect.objectContaining({
					action: "session_started",
					timestamp: 1_700_000_000_000,
				}),
			]);
		},
	);

	it("uses the exact definition category instead of deriving one", async () => {
		await analytics.track("test_event", { data: "test" });

		expect(mockProvider.calls.track[0].event.category).toBe("custom-category");
	});

	it("accepts inferred user traits for identify and event context", async () => {
		await analytics.identify("user-123", {
			email: "test@example.com",
			name: "Test User",
			plan: "pro",
		});
		await analytics.track(
			"test_event",
			{ action: "clicked" },
			{
				user: {
					userId: "user-123",
					email: "test@example.com",
					traits: { plan: "pro" },
				},
			},
		);

		expect(mockProvider.calls.identify[0]).toEqual({
			userId: "user-123",
			traits: {
				email: "test@example.com",
				name: "Test User",
				plan: "pro",
			},
		});
		expect(mockProvider.calls.track[0].context?.user).toEqual({
			userId: "user-123",
			email: "test@example.com",
			traits: { plan: "pro" },
		});
	});

	it("preserves default user context when a track call does not override it", async () => {
		const withDefaultContext = createServerAnalytics({
			events,
			userTraits: typed<UserTraits>(),
			providers: [mockProvider],
			defaultContext: {
				user: {
					userId: "default-user",
					email: "default@example.com",
					traits: { plan: "free" },
				},
			},
		});

		await withDefaultContext.track("test_event", {});

		expect(mockProvider.calls.track[0].context?.user).toEqual({
			userId: "default-user",
			email: "default@example.com",
			traits: { plan: "free" },
		});
	});

	it("accepts propertyless calls with no options or options in argument two", async () => {
		await analytics.track("session_started");
		await analytics.track("session_started", {
			userId: "user_123",
			sessionId: "session_123",
		});

		expect(mockProvider.calls.track).toHaveLength(2);
		expect(mockProvider.calls.track[0].event.properties).toEqual({});
		expect(mockProvider.calls.track[1].event).toMatchObject({
			properties: {},
			userId: "user_123",
			sessionId: "session_123",
		});
	});

	it.each([
		["explicit undefined", undefined],
		["null", null],
		["an array", []],
		["a primitive", "user_123"],
		["unknown option keys", { unexpected: true }],
		["an occurredAt that is not a time", { occurredAt: "yesterday" }],
		["an occurredAt of NaN", { occurredAt: Number.NaN }],
		["an occurredAt beyond a Date's range", { occurredAt: 1.7e18 }],
		["an invalid Date occurredAt", { occurredAt: new Date("not a date") }],
	])(
		"routes propertyless %s through invalid_properties",
		async (_label, value) => {
			const runtimeAnalytics = analytics as unknown as {
				track(name: string, options: unknown): Promise<void>;
			};

			await expect(
				runtimeAnalytics.track("session_started", value),
			).rejects.toMatchObject({ code: "invalid_properties" });
			expect(mockProvider.calls.track).toHaveLength(0);
		},
	);

	it.each([
		["null", null],
		["an array", []],
		["a primitive", "user_123"],
		["unknown option keys", { unexpected: true }],
		["an occurredAt that is not a time", { occurredAt: "yesterday" }],
		["an occurredAt of NaN", { occurredAt: Number.NaN }],
		["an infinite occurredAt", { occurredAt: Number.POSITIVE_INFINITY }],
		["an occurredAt beyond a Date's range", { occurredAt: 1.7e18 }],
		["an invalid Date occurredAt", { occurredAt: new Date("not a date") }],
	])(
		"throws invalid_options for property-bearing %s options",
		async (_label, value) => {
			const onError = vi.fn();
			const strict = createServerAnalytics({
				events,
				providers: [mockProvider],
				validation: { onFailure: "throw", onError },
			});
			const runtimeAnalytics = strict as unknown as {
				track(
					name: string,
					properties: unknown,
					options: unknown,
				): Promise<void>;
			};

			await expect(
				runtimeAnalytics.track("test_event", {}, value),
			).rejects.toMatchObject({ code: "invalid_options" });
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ code: "invalid_options" }),
			);
			expect(mockProvider.calls.track).toHaveLength(0);
		},
	);

	it("drops invalid property-bearing options through the shared policy", async () => {
		const onError = vi.fn();
		const dropping = createServerAnalytics({
			events,
			providers: [mockProvider],
			validation: { onError },
		});
		const runtimeAnalytics = dropping as unknown as {
			track(name: string, properties: unknown, options: unknown): Promise<void>;
		};

		await expect(
			runtimeAnalytics.track("test_event", {}, { unexpected: true }),
		).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "invalid_options" }),
		);
		expect(mockProvider.calls.track).toHaveLength(0);
	});

	it("accepts propertyless calls passing undefined properties with options", async () => {
		const runtimeAnalytics = analytics as unknown as {
			track(name: string, properties: unknown, options: unknown): Promise<void>;
		};

		await runtimeAnalytics.track("session_started", undefined, {
			userId: "user_123",
			sessionId: "session_123",
		});

		expect(mockProvider.calls.track).toHaveLength(1);
		expect(mockProvider.calls.track[0].event).toMatchObject({
			properties: {},
			userId: "user_123",
			sessionId: "session_123",
		});
	});

	it("delivers transformed schema output to every routed provider", async () => {
		const secondProvider = new MockAnalyticsProvider({ enabled: true });
		const transformed = createServerAnalytics({
			events,
			providers: [mockProvider, secondProvider],
			validation: { onFailure: "throw" },
		});

		await transformed.track("normalized_event", { label: "  SIGN UP  " });

		expect(mockProvider.calls.track[0].event.properties).toEqual({
			normalizedLabel: "sign up",
		});
		expect(secondProvider.calls.track[0].event.properties).toEqual({
			normalizedLabel: "sign up",
		});
	});

	it("drops invalid and unknown events by default and reports failures", async () => {
		const onError = vi.fn<(error: AnalyticsValidationError) => void>();
		const dropping = createServerAnalytics({
			events,
			providers: [mockProvider],
			validation: { onError },
		});
		const runtimeAnalytics = dropping as unknown as {
			track(name: string, properties?: unknown): Promise<void>;
		};

		await runtimeAnalytics.track("normalized_event", { label: 42 });
		await runtimeAnalytics.track("not_registered", { secret: true });

		expect(mockProvider.calls.track).toHaveLength(0);
		expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
			"invalid_properties",
			"unknown_event",
		]);
	});

	it("throws validation failures when configured", async () => {
		const runtimeAnalytics = analytics as unknown as {
			track(name: string, properties?: unknown): Promise<void>;
		};

		await expect(
			runtimeAnalytics.track("normalized_event", { label: 42 }),
		).rejects.toMatchObject({ code: "invalid_properties" });
		await expect(
			runtimeAnalytics.track("not_registered", {}),
		).rejects.toMatchObject({ code: "unknown_event" });
		expect(mockProvider.calls.track).toHaveLength(0);
	});

	it("short-circuits disabled instances before initialization and validation", async () => {
		const provider = new MockAnalyticsProvider({ enabled: true });
		const onError = vi.fn();
		const disabled = createServerAnalytics({
			events,
			providers: [provider],
			validation: { onFailure: "throw", onError },
			enabled: false,
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

	it("isolates provider tracking failures", async () => {
		const failing = new MockAnalyticsProvider({ enabled: true });
		failing.name = "Failing";
		failing.track = () => {
			throw new Error("provider failed");
		};
		const succeeding = new MockAnalyticsProvider({ enabled: true });
		const isolated = createServerAnalytics({
			events,
			providers: [failing, succeeding],
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(isolated.track("test_event", {})).resolves.toBeUndefined();
		expect(succeeding.calls.track).toHaveLength(1);
		expect(errorSpy).toHaveBeenCalledWith(
			"[Analytics] Provider Failing failed to track event:",
			expect.any(Error),
		);
		errorSpy.mockRestore();
	});

	it("tracks page views with context", async () => {
		await analytics.pageView(
			{ path: "/dashboard", title: "Dashboard" },
			{ context: { device: { type: "desktop", os: "macOS" } } },
		);

		expect(mockProvider.calls.pageView[0]).toEqual({
			properties: { path: "/dashboard", title: "Dashboard" },
			context: { device: { type: "desktop", os: "macOS" } },
		});
	});

	it("shuts down providers that support it", async () => {
		const shutdownProvider = new MockAnalyticsProvider({
			enabled: true,
		}) as MockAnalyticsProvider & { shutdown: () => Promise<void> };
		const shutdown = vi.fn(async () => {});
		shutdownProvider.shutdown = shutdown;
		const withShutdown = createServerAnalytics({
			events,
			providers: [shutdownProvider],
		});

		await withShutdown.shutdown();

		expect(shutdown).toHaveBeenCalledOnce();
	});
});
