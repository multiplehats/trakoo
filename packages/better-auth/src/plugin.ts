import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { EventName } from "trakoo";
import type { ServerAnalytics } from "trakoo/server";
import { runInBackground } from "./background.js";
import { coreEvents } from "./core.js";
import {
	type AuthChannel,
	type AuthEventKey,
	type AuthEventName,
	authEventDefaults,
	authEventKeys,
	authEvents,
} from "./events.js";
import { field, isoDate, record } from "./fields.js";
import { signInMethod } from "./methods.js";
import { adminEvents } from "./plugins/admin.js";
import { apiKeyEvents } from "./plugins/api-key.js";
import { organizationEvents } from "./plugins/organization.js";
import { passkeyEvents } from "./plugins/passkey.js";
import { ssoEvents } from "./plugins/sso.js";
import { stripeEvents } from "./plugins/stripe.js";
import {
	type AuthSession,
	type AuthUser,
	type EndpointContext,
	type RequestInfo,
	currentEndpointContext,
	requestInfo,
	sessionUserIdOf,
	succeeded,
} from "./request.js";
import {
	type AfterCall,
	type AuthContextLike,
	type Emission,
	type PluginEvents,
	type RequestState,
	type Toolkit,
	findPlugin,
} from "./toolkit.js";

/** Per-event settings. */
export interface EventOverride {
	/** EmitKit channel for this event. */
	channel?: string;
	/** Whether EmitKit sends a push notification for this event. */
	notify?: boolean;
	/** Extra properties merged into the event. */
	properties?: Record<string, unknown>;
}

/** What an `events` function receives. */
export interface AuthEventContext {
	readonly key: AuthEventKey;
	readonly name: AuthEventName;
	readonly userId: string | undefined;
	readonly properties: Readonly<Record<string, unknown>>;
}

export type EventSetting =
	| boolean
	| EventOverride
	| ((
			event: AuthEventContext,
	  ) =>
			| EventOverride
			| false
			| undefined
			| Promise<EventOverride | false | undefined>);

export type AuthTraits = Record<string, unknown>;

// biome-ignore lint/suspicious/noExplicitAny: any registry and user traits
type AnyServerAnalytics = ServerAnalytics<any, any>;

type RegistryOf<A> = A extends ServerAnalytics<infer R, infer _T> ? R : never;

/**
 * A trakoo server analytics instance whose registry includes
 * {@link authEvents}. Anything else is reported at compile time.
 */
export type AuthAnalytics<A extends AnyServerAnalytics> = A &
	([AuthEventName] extends [EventName<RegistryOf<A>>]
		? unknown
		: {
				"Merge authEvents into the registry of this analytics instance: defineEvents({ ...authEvents, ...appEvents })": Exclude<
					AuthEventName,
					EventName<RegistryOf<A>>
				>;
			});

export interface TrakooAuthOptions<A extends AnyServerAnalytics> {
	/** The app's trakoo server analytics instance. */
	analytics: AuthAnalytics<A>;
	/**
	 * Per-event settings: `false` turns an event off, an object overrides its
	 * EmitKit hints or adds properties, and a function decides per occurrence.
	 */
	events?: { [K in AuthEventKey]?: EventSetting };
	/** Emit only these events. */
	include?: AuthEventKey[];
	/** Never emit these events. */
	exclude?: AuthEventKey[];
	/**
	 * Call `identify` on sign-up, sign-in and profile or email changes. Pass a
	 * function to choose the traits, or `false` to send no email or name at
	 * all: the sign-up event then carries no email either.
	 * @default true (email, name, createdAt, emailVerified)
	 */
	identify?: boolean | ((user: AuthUser) => AuthTraits | Promise<AuthTraits>);
	/**
	 * Delivery hints for the EmitKit provider. `false` leaves them out.
	 */
	emitkit?:
		| false
		| {
				/** Rename the default channels, e.g. `{ auth: "signups" }`. */
				channels?: Partial<Record<AuthChannel, string>>;
				/**
				 * `true` or `false` for every event, or the events that notify.
				 * Defaults to new users, new organizations, accepted invitations
				 * and new subscriptions.
				 */
				notify?: boolean | AuthEventKey[];
		  };
	/** Last chance to remove or rewrite properties before they are sent. */
	redact?: (
		properties: Record<string, unknown>,
		event: { key: AuthEventKey; name: AuthEventName },
	) => Record<string, unknown>;
	/**
	 * Forward the caller's IP address and user agent as `context.server`.
	 * Better Auth's `advanced.ipAddress` settings apply.
	 * @default true
	 */
	requestContext?: boolean;
	/** Receives tracking failures. They never reach Better Auth. */
	onError?: (error: unknown) => void;
}

export interface TrakooAuthPlugin extends BetterAuthPlugin {
	id: "trakoo";
	/** The events this plugin emits for the Better Auth instance it last initialized. */
	readonly activeEvents: ReadonlySet<AuthEventKey>;
}

const PLUGIN_ID = "trakoo";
/** How long an event waits for identify before it is sent anyway. */
const IDENTIFY_TIMEOUT_MS = 3000;
const LOG_PREFIX = "[trakoo/better-auth]";
const WRAPPED = Symbol.for("trakoo.better-auth.wrapped");

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
	if (warned.has(key)) return;
	warned.add(key);
	console.warn(`${LOG_PREFIX} ${message}`);
}

/** Traits sent with identify unless the `identify` option replaces them. */
export function defaultTraits(user: AuthUser): AuthTraits {
	const traits: AuthTraits = {};
	if (typeof user.email === "string" && user.email) traits.email = user.email;
	if (typeof user.name === "string" && user.name) traits.name = user.name;
	const createdAt = isoDate(user.createdAt);
	if (createdAt) traits.createdAt = createdAt;
	if (typeof user.emailVerified === "boolean") {
		traits.emailVerified = user.emailVerified;
	}
	return traits;
}

/**
 * The request's sessions, the one it creates first. Read them when the event
 * happens: the request replaces its new session as it goes on.
 */
function sessionsOf(ctx: EndpointContext | undefined): AuthSession[] {
	return [
		ctx?.context.newSession?.session,
		ctx?.context.session?.session,
	].filter(
		(session): session is AuthSession => typeof session?.id === "string",
	);
}

/**
 * Better Auth plugin that emits a typed trakoo event for every meaningful auth
 * lifecycle change. Register it last, after plugins such as `twoFactor`.
 *
 * ```ts
 * betterAuth({
 *   plugins: [organization(), trakooAuth({ analytics })],
 * });
 * ```
 */
export function trakooAuth<A extends AnyServerAnalytics>(
	options: TrakooAuthOptions<A>,
): TrakooAuthPlugin {
	const analytics = options.analytics as unknown as {
		track: (
			name: string,
			properties: Record<string, unknown>,
			options: Record<string, unknown>,
		) => Promise<void>;
		identify: (
			userId: string,
			traits?: AuthTraits,
			options?: Record<string, unknown>,
		) => Promise<void> | void;
	};
	const states = new WeakMap<object, RequestState>();
	let active: ReadonlySet<AuthEventKey> = new Set();
	let authContext: AuthContextLike | undefined;
	const token = {};

	const reportError = (error: unknown): void => {
		try {
			if (options.onError) {
				options.onError(error);
				return;
			}
			const kind = error instanceof Error ? error.name : typeof error;
			console.error(`${LOG_PREFIX} Failed to send an auth event (${kind})`);
		} catch {
			// Error reporting must never reach Better Auth.
		}
	};

	/** Runs a hook body; a failure is reported, never thrown. */
	const guard = (body: () => void): void => {
		try {
			body();
		} catch (error) {
			reportError(error);
		}
	};

	const stateOf = (
		ctx: EndpointContext | undefined,
	): RequestState | undefined => {
		const key = ctx?.context;
		if (!key) return undefined;
		let state = states.get(key);
		if (!state) {
			state = { createdUsers: new Set(), userUpdates: [] };
			states.set(key, state);
		}
		return state;
	};

	const isOn = (key: AuthEventKey) => active.has(key);

	async function resolveSetting(
		key: AuthEventKey,
		emission: Emission,
	): Promise<EventOverride | false> {
		const setting = options.events?.[key];
		if (setting === false) return false;
		if (setting === undefined || setting === true) return {};
		if (typeof setting === "function") {
			const result = await setting({
				key,
				name: authEvents[key].name,
				userId: emission.userId,
				properties: { ...emission.properties },
			});
			return result === false ? false : (result ?? {});
		}
		return setting;
	}

	function notifyFor(key: AuthEventKey, override: EventOverride): boolean {
		if (typeof override.notify === "boolean") return override.notify;
		const setting = options.emitkit ? options.emitkit.notify : undefined;
		if (typeof setting === "boolean") return setting;
		if (Array.isArray(setting)) return setting.includes(key);
		return authEventDefaults[key].notify;
	}

	function channelFor(key: AuthEventKey, override: EventOverride): string {
		if (override.channel) return override.channel;
		const channel = authEventDefaults[key].channel;
		return (options.emitkit || undefined)?.channels?.[channel] || channel;
	}

	/** The one reading of the `identify` option. */
	async function traitsFor(user: AuthUser): Promise<AuthTraits | undefined> {
		if (options.identify === false) return undefined;
		if (typeof options.identify === "function") {
			return options.identify(user);
		}
		return defaultTraits(user);
	}

	async function send(
		key: AuthEventKey,
		emission: Emission,
		request: RequestInfo | undefined,
	): Promise<void> {
		// Let the request continue before any user callback runs.
		await Promise.resolve();

		const override = await resolveSetting(key, emission);
		if (override === false) return;

		const { user } = emission;
		const known = user !== undefined && !user.isAnonymous;
		const identifies =
			known && (emission.identify ?? authEventDefaults[key].identify === true);
		let traits: AuthTraits | undefined;
		if (known && (identifies || emission.withEmail)) {
			try {
				traits = await traitsFor(user);
			} catch (error) {
				reportError(error);
			}
		}
		if (identifies && traits && emission.userId) {
			// A failed or slow identify must not cost any provider the event.
			try {
				await withTimeout(
					Promise.resolve(
						// The request places the profile at the user, not this server.
						request
							? analytics.identify(emission.userId, traits, {
									context: { server: { ...request } },
								})
							: analytics.identify(emission.userId, traits),
					),
					IDENTIFY_TIMEOUT_MS,
				);
			} catch (error) {
				reportError(error);
			}
		}

		let properties: Record<string, unknown> = {
			...emission.properties,
			...override.properties,
		};
		if (options.redact) {
			properties = options.redact(properties, {
				key,
				name: authEvents[key].name,
			});
		}
		if (options.emitkit !== false) {
			properties = {
				...properties,
				__emitkit_channel: channelFor(key, override),
				__emitkit_notify: notifyFor(key, override),
			};
		}

		// The email goes to providers only when the identify traits include it;
		// `pii: false` routing keeps it from a provider.
		const email =
			emission.withEmail && typeof traits?.email === "string"
				? traits.email
				: undefined;
		const trackOptions: Record<string, unknown> = {};
		if (emission.userId) trackOptions.userId = emission.userId;
		if (emission.sessionId) trackOptions.sessionId = emission.sessionId;
		if (email && emission.userId) {
			trackOptions.user = { userId: emission.userId, email };
		}
		if (request) trackOptions.context = { server: { ...request } };

		await analytics.track(authEvents[key].name, properties, trackOptions);
	}

	const emit: Toolkit["emit"] = (key, ctx, emission) => {
		if (!isOn(key)) return;
		const request = requestOf(ctx);
		const sessions = sessionsOf(ctx);
		runInBackground(
			async () => {
				const resolved =
					typeof emission === "function" ? await emission() : emission;
				if (!resolved) return;
				const sessionId =
					resolved.sessionId ??
					sessions.find((session) => session.userId === resolved.userId)?.id;
				await send(key, { ...resolved, sessionId }, request);
			},
			currentAuthContext()?.options,
			reportError,
		);
	};

	/**
	 * The auth context of the call in progress. One plugin object can serve
	 * several Better Auth instances, so the one captured at init is only the
	 * fallback outside a call.
	 */
	const currentAuthContext = (): AuthContextLike | undefined =>
		(currentEndpointContext()?.context as AuthContextLike | undefined) ??
		authContext;

	const requestOf = (ctx: EndpointContext | undefined) =>
		options.requestContext === false ? undefined : requestInfo(ctx);

	const actorOf: Toolkit["actorOf"] = (ctx, subject) => {
		const actor = sessionUserIdOf(ctx);
		return actor && actor !== subject ? { actorUserId: actor } : {};
	};

	const wrap: Toolkit["wrap"] = (target, name, handler) => {
		if (!target) return;
		const existing = target[name] as
			| (((...args: unknown[]) => unknown) & { [WRAPPED]?: object })
			| undefined;
		if (existing?.[WRAPPED] === token) return;
		// Another trakooAuth instance's wrapper stays in the chain.
		const original = existing;
		const wrapped = Object.assign(
			async (...args: unknown[]) => {
				const result = original ? await original(...args) : undefined;
				guard(() => handler(...args));
				return result;
			},
			{ [WRAPPED]: token },
		);
		target[name] = wrapped;
	};

	const toolkit: Toolkit = {
		emit,
		stateOf,
		actorOf,
		wrap,
		currentAuthContext,
	};
	const core = coreEvents(toolkit);
	const pluginEvents: PluginEvents[] = [
		core,
		organizationEvents(toolkit),
		apiKeyEvents(toolkit),
		adminEvents(toolkit),
		passkeyEvents(toolkit),
		ssoEvents(toolkit),
		stripeEvents(toolkit),
	];
	const afterHandlers = new Map(
		pluginEvents.flatMap((events) => Object.entries(events.after ?? {})),
	);

	const onAfter = (ctx: EndpointContext) => {
		const returned = ctx.context.returned;
		if (!succeeded(returned)) return;

		const method = signInMethod(ctx);
		if (method) {
			core.signIn(ctx, method);
			return;
		}

		const call: AfterCall = {
			ctx,
			returned,
			body: record(ctx.body),
			sessionUserId: sessionUserIdOf(ctx),
		};
		if (ctx.path) afterHandlers.get(ctx.path)?.(call);
	};

	function activate(context: AuthContextLike): Set<AuthEventKey> {
		const plugins = context.options.plugins ?? [];
		const installed = new Set(plugins.map((plugin) => plugin.id));
		const teams =
			field(findPlugin(context, "organization")?.options?.teams, "enabled") ===
			true;
		/** What `key` needs that this Better Auth instance lacks. */
		const missing = (key: AuthEventKey): string | undefined => {
			const defaults = authEventDefaults[key];
			if (defaults.plugin && !installed.has(defaults.plugin)) {
				return `the Better Auth "${defaults.plugin}" plugin, which is not installed`;
			}
			if (defaults.teams && !teams) {
				return "the organization plugin's teams, which are not enabled";
			}
			return undefined;
		};

		const referenced = new Set<AuthEventKey>([
			...(options.include ?? []),
			...(options.exclude ?? []),
			...(Object.keys(options.events ?? {}) as AuthEventKey[]),
			...(options.emitkit && Array.isArray(options.emitkit.notify)
				? options.emitkit.notify
				: []),
		]);
		for (const key of referenced) {
			if (!(key in authEventDefaults)) {
				warnOnce(`unknown:${key}`, `Ignoring unknown event "${key}".`);
				continue;
			}
			const need = missing(key);
			if (need) {
				warnOnce(`missing:${key}`, `Ignoring "${key}": it needs ${need}.`);
			}
		}

		const include = options.include ? new Set(options.include) : undefined;
		const exclude = new Set(options.exclude ?? []);
		return new Set(
			authEventKeys.filter(
				(key) =>
					!missing(key) &&
					(!include || include.has(key)) &&
					!exclude.has(key) &&
					options.events?.[key] !== false,
			),
		);
	}

	/** A database hook that reports through `handler` and never throws. */
	const databaseHook =
		<T>(handler: (row: T, ctx: EndpointContext | undefined) => void) =>
		async (row: T, ctx?: EndpointContext | null) =>
			guard(() => handler(row, ctx ?? undefined));

	const plugin = {
		id: PLUGIN_ID,
		get activeEvents() {
			return active;
		},
		init(ctx: unknown) {
			try {
				const context = ctx as AuthContextLike;
				authContext = context;
				active = activate(context);

				const plugins = context.options.plugins ?? [];
				const position = plugins.findIndex((entry) => entry === plugin);
				const later = plugins.slice(position + 1).map((entry) => entry.id);
				const mustPrecede = ["two-factor", "anonymous"].filter((id) =>
					later.includes(id),
				);
				if (position >= 0 && mustPrecede.length > 0) {
					warnOnce(
						"order",
						`Register trakooAuth() last in "plugins", after ${mustPrecede.join(" and ")}. Otherwise a sign-in waiting for its second factor is reported as complete and anonymous account links are missed.`,
					);
				}

				for (const events of pluginEvents) events.init?.(context);
			} catch (error) {
				reportError(error);
			}

			return {
				options: {
					databaseHooks: {
						user: {
							create: { after: databaseHook(core.userCreated) },
							update: {
								// Returning nothing leaves the write untouched.
								before: databaseHook(core.userUpdating),
								after: databaseHook(core.userUpdated),
							},
							delete: { after: databaseHook(core.userDeleted) },
						},
						account: {
							create: { after: databaseHook(core.accountCreated) },
							delete: { after: databaseHook(core.accountDeleted) },
						},
					},
				},
			};
		},
		hooks: {
			before: [
				{
					// Sessions can live in secondary storage, where no database hook
					// sees them end, so sign-out reads the session it is ending.
					matcher: (ctx: { path?: string }) =>
						ctx.path === "/sign-out" && isOn("userSignedOut"),
					handler: createAuthMiddleware(async (ctx) => {
						try {
							const session = await getSessionFromCtx(ctx, {
								disableRefresh: true,
							});
							const state = stateOf(ctx as unknown as EndpointContext);
							if (session && state) {
								state.signingOut = {
									userId: session.user.id,
									sessionId: session.session.id,
								};
							}
						} catch (error) {
							reportError(error);
						}
					}),
				},
			],
			after: [
				{
					matcher: (ctx: { path?: string }) =>
						!!ctx.path &&
						(afterHandlers.has(ctx.path) ||
							signInMethod(ctx as EndpointContext) !== undefined),
					handler: createAuthMiddleware(async (ctx) => {
						guard(() => onAfter(ctx as unknown as EndpointContext));
					}),
				},
			],
		},
	};

	return plugin as unknown as TrakooAuthPlugin;
}

/** Settles with `promise`, or rejects once `ms` pass. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`identify did not finish within ${ms}ms`)),
				ms,
			);
		}),
	]).finally(() => clearTimeout(timer));
}
