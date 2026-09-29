import { betterAuth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
	type AnalyticsProvider,
	type BaseEvent,
	defineEvents,
	type EventContext,
	typed,
} from "trakoo";
import { createServerAnalytics } from "trakoo/server";
import { expect } from "vitest";
import {
	authEvents,
	type TrakooAuthOptions,
	trakooAuth,
} from "../src/index.js";

export const appEvents = defineEvents({
	...authEvents,
	checkoutCompleted: {
		name: "checkout_completed",
		category: "conversion",
		properties: typed<{ orderId: string }>(),
	},
});

export interface TrackedCall {
	name: string;
	category: string;
	properties: Record<string, unknown>;
	userId?: string;
	sessionId?: string;
	context?: EventContext;
}

/** A trakoo provider that records what it receives. */
export class RecordingProvider implements AnalyticsProvider {
	name = "Recording";
	tracked: TrackedCall[] = [];
	identified: Array<{ userId: string; traits?: Record<string, unknown> }> = [];
	initialize() {}
	identify(userId: string, traits?: Record<string, unknown>) {
		this.identified.push({ userId, traits });
	}
	track(event: BaseEvent, context?: EventContext) {
		this.tracked.push({
			name: event.action,
			category: event.category,
			properties: (event.properties ?? {}) as Record<string, unknown>,
			userId: event.userId,
			sessionId: event.sessionId,
			context,
		});
	}
	pageView() {}
	reset() {}

	names(): string[] {
		return this.tracked.map((call) => call.name);
	}
	find(name: string): TrackedCall {
		const call = this.tracked.find((entry) => entry.name === name);
		if (!call) {
			throw new Error(
				`${name} was not tracked; got ${this.names().join(", ")}`,
			);
		}
		return call;
	}
	clear() {
		this.tracked = [];
		this.identified = [];
	}
}

export const PASSWORD = "correct-horse-battery-staple";

const baseTables = ["user", "session", "account", "verification"];

type PluginOptions = Omit<
	TrakooAuthOptions<ReturnType<typeof createAppAnalytics>>,
	"analytics"
>;

export function createAppAnalytics(provider: AnalyticsProvider) {
	return createServerAnalytics({ events: appEvents, providers: [provider] });
}

export interface Harness {
	auth: ReturnType<typeof betterAuth>;
	// biome-ignore lint/suspicious/noExplicitAny: typed per test through auth.api
	api: any;
	provider: RecordingProvider;
	plugin: ReturnType<typeof trakooAuth>;
	db: Record<string, Record<string, unknown>[]>;
	/** Waits for every tracking task handed to the background handler. */
	flush: () => Promise<void>;
	/** Values that must never reach a provider. */
	secrets: Set<string>;
	signUp: (
		email?: string,
		name?: string,
	) => Promise<{ userId: string; headers: Headers; token: string }>;
	signIn: (email: string) => Promise<{ headers: Headers; token: string }>;
}

export async function createHarness(
	setup: {
		plugins?: BetterAuthOptions["plugins"];
		options?: Partial<BetterAuthOptions>;
		trakoo?: PluginOptions;
		tables?: string[];
		provider?: AnalyticsProvider;
		/** Leave Better Auth without a background handler. */
		noBackgroundHandler?: boolean;
		/** Register trakooAuth before the other plugins. */
		trakooFirst?: boolean;
	} = {},
): Promise<Harness> {
	const recording = new RecordingProvider();
	const analytics = createAppAnalytics(setup.provider ?? recording);
	const plugin = trakooAuth({ analytics, ...setup.trakoo });
	const db: Record<string, Record<string, unknown>[]> = {};
	for (const table of [...baseTables, ...(setup.tables ?? [])]) db[table] = [];

	const pending: Promise<unknown>[] = [];
	const others = setup.plugins ?? [];
	const auth = betterAuth({
		secret: "trakoo-better-auth-test-secret-0123456789abcdef",
		baseURL: "http://localhost:3000",
		database: memoryAdapter(db),
		emailAndPassword: { enabled: true },
		logger: { disabled: true },
		telemetry: { enabled: false },
		...setup.options,
		advanced: {
			...setup.options?.advanced,
			...(setup.noBackgroundHandler
				? {}
				: {
						backgroundTasks: {
							handler: (promise: Promise<unknown>) => {
								pending.push(promise);
							},
						},
					}),
		},
		plugins: setup.trakooFirst ? [plugin, ...others] : [...others, plugin],
	});
	await auth.$context;

	const secrets = new Set<string>([PASSWORD]);
	const flush = async () => {
		while (pending.length > 0) await Promise.all(pending.splice(0));
	};

	const api = auth.api as Harness["api"];

	const rememberCookies = (headers: Headers) => {
		const cookie = headers.get("set-cookie") ?? "";
		const token = /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1] ?? "";
		if (token) {
			secrets.add(decodeURIComponent(token));
			secrets.add(decodeURIComponent(token).split(".")[0]);
		}
		return {
			headers: new Headers({ cookie: `better-auth.session_token=${token}` }),
			token: decodeURIComponent(token).split(".")[0],
		};
	};

	const signUp: Harness["signUp"] = async (
		email = "ada@example.com",
		name = "Ada Lovelace",
	) => {
		const result = await api.signUpEmail({
			body: { email, password: PASSWORD, name },
			returnHeaders: true,
		});
		if (result.response.token) secrets.add(result.response.token);
		return {
			userId: result.response.user.id,
			...rememberCookies(result.headers),
		};
	};

	const signIn: Harness["signIn"] = async (email) => {
		const result = await api.signInEmail({
			body: { email, password: PASSWORD },
			returnHeaders: true,
		});
		if (result.response.token) secrets.add(result.response.token);
		return rememberCookies(result.headers);
	};

	return {
		auth: auth as unknown as ReturnType<typeof betterAuth>,
		api,
		provider: recording,
		plugin,
		db,
		flush,
		secrets,
		signUp,
		signIn,
	};
}

/** Turns a response's Set-Cookie header into a Cookie request header. */
export function cookiesFrom(response: Headers): Headers {
	const cookies = response
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0].trim())
		.filter((cookie) => !cookie.endsWith("="));
	return new Headers({ cookie: cookies.join("; ") });
}

/** Asserts no recorded call contains any secret the test collected. */
export function expectNoSecrets(harness: Harness): void {
	const sent = JSON.stringify({
		tracked: harness.provider.tracked,
		identified: harness.provider.identified,
	});
	for (const secret of harness.secrets) {
		if (secret.length < 6) continue;
		expect(
			sent,
			`a provider received a secret: ${secret.slice(0, 4)}…`,
		).not.toContain(secret);
	}
	// Session tokens, API keys and hashes never appear under these names.
	expect(sent).not.toMatch(
		/"(token|password|key|secret|totpURI|backupCodes|otp)"\s*:/i,
	);
}
