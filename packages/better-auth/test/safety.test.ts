import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { type AnalyticsProvider, defineEvents, typed } from "trakoo";
import { createServerAnalytics } from "trakoo/server";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { resetBackgroundWarning } from "../src/background.js";
import { authEvents, trakooAuth } from "../src/index.js";
import {
	appEvents,
	createHarness,
	expectNoSecrets,
	type Harness,
	PASSWORD,
	RecordingProvider,
} from "./helpers.js";

let harness: Harness | undefined;
afterEach(() => {
	if (harness) expectNoSecrets(harness);
	harness = undefined;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

const never = () => new Promise<never>(() => {});

/** Resolves with `promise`, or rejects when it takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms),
		),
	]);
}

class StalledProvider implements AnalyticsProvider {
	name = "Stalled";
	initialize() {}
	identify = vi.fn(never);
	track = vi.fn(never);
	pageView() {}
	reset() {}
}

class FailingProvider implements AnalyticsProvider {
	name = "Failing";
	initialize() {}
	identify = vi.fn(async () => {
		throw new Error("provider is down");
	});
	track = vi.fn(async () => {
		throw new Error("provider is down");
	});
	pageView() {}
	reset() {}
}

describe("a provider outage", () => {
	it("does not hold up sign-up when a provider never answers", async () => {
		const provider = new StalledProvider();
		harness = await createHarness({ provider, noBackgroundHandler: true });

		const result = await within(harness.signUp(), 1000);

		expect(result.userId).toEqual(expect.any(String));
		expect(harness.db.user).toHaveLength(1);
		await vi.waitFor(() => expect(provider.identify).toHaveBeenCalled());
	});

	it("does not hold up sign-up behind Better Auth's background handler", async () => {
		const provider = new StalledProvider();
		harness = await createHarness({ provider });

		await within(harness.signUp(), 1000);
		await within(harness.signIn("ada@example.com"), 1000);

		expect(harness.db.session).toHaveLength(2);
	});

	it("keeps sign-up working when a provider fails and reports the failure", async () => {
		const onError = vi.fn();
		const provider = new FailingProvider();
		vi.spyOn(console, "error").mockImplementation(() => {});
		harness = await createHarness({ provider, trakoo: { onError } });

		const { userId } = await harness.signUp();
		await harness.flush();

		expect(harness.db.user[0].id).toBe(userId);
		// identify rejects to the caller; track failures are isolated by trakoo.
		expect(onError).toHaveBeenCalledWith(expect.any(Error));
	});

	it("survives an onError callback that throws", async () => {
		harness = await createHarness({
			provider: new FailingProvider(),
			trakoo: {
				onError: () => {
					throw new Error("reporter is down too");
				},
			},
		});
		vi.spyOn(console, "error").mockImplementation(() => {});

		await harness.signUp();
		await expect(harness.flush()).resolves.toBeUndefined();
	});

	it("keeps auth working when the app's own callbacks throw", async () => {
		const onError = vi.fn();
		harness = await createHarness({
			trakoo: {
				onError,
				identify: () => {
					throw new Error("identify callback failed");
				},
				redact: () => {
					throw new Error("redact callback failed");
				},
				events: {
					userSignedIn: () => {
						throw new Error("events callback failed");
					},
				},
			},
		});

		await harness.signUp();
		await harness.signIn("ada@example.com");
		await harness.flush();

		expect(onError).toHaveBeenCalledTimes(2);
		// A failing redact drops the event instead of sending it unredacted.
		expect(harness.provider.tracked).toEqual([]);
	});

	it("reports strict validation failures instead of throwing into Better Auth", async () => {
		const onError = vi.fn();
		const provider = new RecordingProvider();
		const analytics = createServerAnalytics({
			events: defineEvents({
				checkoutCompleted: {
					name: "checkout_completed",
					category: "conversion",
					properties: typed<{ orderId: string }>(),
				},
			}),
			providers: [provider],
			validation: { onFailure: "throw" },
		});
		const auth = betterAuth({
			secret: "trakoo-better-auth-test-secret-0123456789abcdef",
			baseURL: "http://localhost:3000",
			database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
			emailAndPassword: { enabled: true },
			logger: { disabled: true },
			plugins: [
				// @ts-expect-error the registry lacks authEvents
				trakooAuth({ analytics, onError }),
			],
		});

		const result = await auth.api.signUpEmail({
			body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
		});

		expect(result.user.id).toEqual(expect.any(String));
		await vi.waitFor(() =>
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ code: "unknown_event" }),
			),
		);
	});
});

describe("background delivery", () => {
	it("hands tracking to Vercel's waitUntil when no handler is configured", async () => {
		const waitUntil = vi.fn();
		vi.stubGlobal(Symbol.for("@vercel/request-context") as unknown as string, {
			get: () => ({ waitUntil }),
		});
		harness = await createHarness({ noBackgroundHandler: true });

		await harness.signUp();

		expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
	});

	it("warns once on a serverless runtime without a background handler", async () => {
		resetBackgroundWarning();
		vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "auth");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		harness = await createHarness({ noBackgroundHandler: true });

		await harness.signUp();
		await harness.signIn("ada@example.com");

		const warnings = warn.mock.calls.filter(([message]) =>
			String(message).includes("backgroundTasks.handler"),
		);
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0][0])).toContain("AWS Lambda");
	});
});

describe("configuration", () => {
	it("limits events with include and exclude", async () => {
		harness = await createHarness({
			trakoo: { include: ["userSignedUp", "userSignedIn"], exclude: ["userSignedIn"] },
		});
		expect([...harness.plugin.activeEvents]).toEqual(["userSignedUp"]);

		const { headers } = await harness.signUp();
		await harness.signIn("ada@example.com");
		await harness.api.signOut({ headers });
		await harness.flush();

		expect(harness.provider.names()).toEqual(["user_signed_up"]);
	});

	it("applies per-event overrides and per-occurrence decisions", async () => {
		harness = await createHarness({
			trakoo: {
				events: {
					userSignedOut: false,
					userSignedUp: {
						channel: "signups",
						notify: false,
						properties: { source: "web" },
					},
					userSignedIn: ({ properties }) =>
						properties.method === "email"
							? { notify: true, properties: { firstFactor: "password" } }
							: false,
				},
			},
		});

		const { headers } = await harness.signUp();
		await harness.signIn("ada@example.com");
		await harness.api.signOut({ headers });
		await harness.flush();

		expect(harness.provider.names()).toEqual(["user_signed_up", "user_signed_in"]);
		expect(harness.provider.find("user_signed_up").properties).toMatchObject({
			method: "email",
			source: "web",
			__emitkit_channel: "signups",
			__emitkit_notify: false,
		});
		expect(harness.provider.find("user_signed_in").properties).toMatchObject({
			firstFactor: "password",
			__emitkit_notify: true,
		});
	});

	it("renames channels and sets notify for a list of events", async () => {
		harness = await createHarness({
			trakoo: {
				emitkit: {
					channels: { auth: "people" },
					notify: ["userSignedIn"],
				},
			},
		});

		await harness.signUp();
		await harness.signIn("ada@example.com");
		await harness.flush();

		expect(harness.provider.find("user_signed_up").properties).toMatchObject({
			__emitkit_channel: "people",
			__emitkit_notify: false,
		});
		expect(harness.provider.find("user_signed_in").properties).toMatchObject({
			__emitkit_channel: "people",
			__emitkit_notify: true,
		});
	});

	it("leaves the EmitKit hints out with emitkit: false", async () => {
		harness = await createHarness({ trakoo: { emitkit: false } });
		await harness.signUp();
		await harness.flush();

		expect(harness.provider.find("user_signed_up").properties).toEqual({
			method: "email",
			emailVerified: false,
		});
	});

	it("sends no email or name anywhere with identify: false", async () => {
		harness = await createHarness({ trakoo: { identify: false } });
		await harness.signUp();
		await harness.signIn("ada@example.com");
		await harness.flush();

		expect(harness.provider.identified).toEqual([]);
		expect(harness.provider.find("user_signed_up").context?.user).toBeUndefined();
		const sent = JSON.stringify(harness.provider.tracked);
		expect(sent).not.toContain("ada@example.com");
		expect(sent).not.toContain("Ada Lovelace");
	});

	it("uses the traits an identify function returns, email included only if returned", async () => {
		harness = await createHarness({
			trakoo: {
				identify: (user) => ({ plan: "free", createdAt: String(user.createdAt) }),
			},
		});
		const { userId } = await harness.signUp();
		await harness.flush();

		expect(harness.provider.identified).toEqual([
			{ userId, traits: { plan: "free", createdAt: expect.any(String) } },
		]);
		expect(harness.provider.find("user_signed_up").context?.user).toBeUndefined();
	});

	it("redacts properties before they are sent", async () => {
		harness = await createHarness({
			trakoo: {
				redact: ({ provider: _provider, ...properties }, event) => ({
					...properties,
					redactedFor: event.name,
				}),
			},
		});
		await harness.signUp();
		await harness.flush();

		expect(harness.provider.find("user_signed_up").properties).toMatchObject({
			method: "email",
			redactedFor: "user_signed_up",
		});
	});

	it("forwards no request context with requestContext: false or IP tracking disabled", async () => {
		const request = new Headers({
			"user-agent": "Mozilla/5.0",
			"x-forwarded-for": "203.0.113.7",
		});

		harness = await createHarness({ trakoo: { requestContext: false } });
		await harness.api.signUpEmail({
			body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
			headers: request,
		});
		await harness.flush();
		expect(harness.provider.find("user_signed_up").context?.server).toBeUndefined();

		harness = await createHarness({
			options: { advanced: { ipAddress: { disableIpTracking: true } } },
		});
		await harness.api.signUpEmail({
			body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
			headers: request,
		});
		await harness.flush();
		expect(harness.provider.find("user_signed_up").context?.server).toEqual({
			userAgent: "Mozilla/5.0",
		});
	});

	it("warns once, without throwing, about events for plugins that are not installed", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		harness = await createHarness({
			trakoo: {
				include: ["userSignedUp", "apiKeyCreated"],
				events: { apiKeyCreated: { notify: true } },
			},
		});
		await createHarness({ trakoo: { include: ["apiKeyCreated"] } });

		const warnings = warn.mock.calls.filter(([message]) =>
			String(message).includes('"apiKeyCreated"'),
		);
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0][0])).toContain('"api-key" plugin');
		expect([...harness.plugin.activeEvents]).toEqual(["userSignedUp"]);
	});

	it("registers plugin events only for installed plugins", async () => {
		harness = await createHarness({
			plugins: [organization(), apiKey()],
			tables: ["organization", "member", "invitation", "apikey"],
		});
		const active = harness.plugin.activeEvents;

		expect(active.has("organizationCreated")).toBe(true);
		expect(active.has("apiKeyCreated")).toBe(true);
		expect(active.has("userBanned")).toBe(false);
		expect(active.has("subscriptionStarted")).toBe(false);
	});
});

describe("personal data routing", () => {
	it("gives the email tool the email while pii: false keeps it from analytics", async () => {
		const analyticsTool = new RecordingProvider();
		const emailTool = new RecordingProvider();
		const analytics = createServerAnalytics({
			events: appEvents,
			providers: [
				{ provider: analyticsTool, pii: false },
				{ provider: emailTool, events: ["user_signed_up"] },
			],
		});
		const pending: Promise<unknown>[] = [];
		const auth = betterAuth({
			secret: "trakoo-better-auth-test-secret-0123456789abcdef",
			baseURL: "http://localhost:3000",
			database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
			emailAndPassword: { enabled: true },
			logger: { disabled: true },
			advanced: { backgroundTasks: { handler: (p) => pending.push(p) } },
			plugins: [trakooAuth({ analytics })],
		});

		const { user } = await auth.api.signUpEmail({
			body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
		});
		await Promise.all(pending);

		expect(JSON.stringify(analyticsTool)).not.toContain("ada@example.com");
		expect(JSON.stringify(analyticsTool)).not.toContain('"Ada"');
		expect(analyticsTool.identified).toEqual([
			{ userId: user.id, traits: { createdAt: expect.any(String), emailVerified: false } },
		]);
		expect(emailTool.find("user_signed_up").context?.user?.email).toBe(
			"ada@example.com",
		);
		expect(emailTool.identified[0].traits?.email).toBe("ada@example.com");
	});
});

describe("types", () => {
	it("accepts an analytics instance whose registry includes authEvents", () => {
		const analytics = createServerAnalytics({
			events: appEvents,
			providers: [],
		});
		expectTypeOf(trakooAuth({ analytics }).id).toEqualTypeOf<"trakoo">();
		expectTypeOf(analytics.track)
			.parameter(0)
			.toEqualTypeOf<
				| (typeof authEvents)[keyof Omit<typeof authEvents, symbol>]["name"]
				| "checkout_completed"
			>();
	});

	it("rejects an analytics instance without authEvents", () => {
		const analytics = createServerAnalytics({
			events: defineEvents({
				checkoutCompleted: {
					name: "checkout_completed",
					category: "conversion",
					properties: typed<{ orderId: string }>(),
				},
			}),
			providers: [],
		});
		// @ts-expect-error authEvents are missing from the registry
		trakooAuth({ analytics });
	});
});
