import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { EventName } from "trakoo";
import type { ServerAnalytics } from "trakoo/server";
import { type BackgroundOptions, runInBackground } from "./background.js";
import {
	type AuthChannel,
	type AuthEventKey,
	type AuthEventName,
	authEventDefaults,
	authEventKeys,
	authEvents,
} from "./events.js";
import { type SignInMethod, signInMethod } from "./methods.js";
import {
	type AuthUser,
	currentEndpointContext,
	type EndpointContext,
	isoDate,
	objectField,
	type RequestInfo,
	requestInfo,
	stringField,
	succeeded,
} from "./request.js";

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

interface RequestState {
	createdUsers: Set<string>;
	userUpdates: Set<string>[];
	/** The session a sign-out request is ending. */
	signingOut?: { userId: string; sessionId: string };
	linkedAnonymousUserId?: string;
}

interface Emission {
	userId: string | undefined;
	sessionId?: string;
	properties: Record<string, unknown>;
	/** Identify this user first, when the event identifies. */
	user?: AuthUser;
	/** Attach the user's email to the event (sign-up only). */
	withEmail?: boolean;
	request?: RequestInfo;
	identify?: boolean;
}

interface PluginLike {
	id: string;
	options?: Record<string, unknown>;
}

interface AuthContextLike extends BackgroundOptions {
	options: BackgroundOptions & {
		plugins?: PluginLike[];
		emailAndPassword?: Record<string, unknown>;
	};
	internalAdapter?: {
		findUserById?: (id: string) => Promise<unknown>;
	};
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

const adminPaths = new Set([
	"/admin/ban-user",
	"/admin/unban-user",
	"/admin/set-role",
	"/admin/create-user",
	"/admin/impersonate-user",
	"/admin/stop-impersonating",
]);

const afterPaths = new Set([
	"/sign-out",
	"/revoke-session",
	"/revoke-sessions",
	"/revoke-other-sessions",
	"/change-password",
	"/api-key/create",
	"/api-key/update",
	"/api-key/delete",
	"/passkey/verify-registration",
	"/passkey/delete-passkey",
	"/sso/register",
	"/sso/delete-provider",
	"/organization/leave",
	...adminPaths,
]);

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
		identify: (userId: string, traits?: AuthTraits) => Promise<void> | void;
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

	async function traitsFor(user: AuthUser): Promise<AuthTraits | undefined> {
		if (options.identify === false) return undefined;
		if (typeof options.identify === "function") {
			return options.identify(user);
		}
		return defaultTraits(user);
	}

	async function send(key: AuthEventKey, emission: Emission): Promise<void> {
		// Let the request continue before any user callback runs.
		await Promise.resolve();

		const override = await resolveSetting(key, emission);
		if (override === false) return;

		const { user } = emission;
		const identifies =
			(emission.identify ?? authEventDefaults[key].identify === true) &&
			user !== undefined &&
			!user.isAnonymous;
		let traits: AuthTraits | undefined;
		if (identifies && user) {
			// A failed or slow identify must not cost any provider the event.
			try {
				traits = await traitsFor(user);
				if (traits && emission.userId) {
					await withTimeout(
						Promise.resolve(analytics.identify(emission.userId, traits)),
						IDENTIFY_TIMEOUT_MS,
					);
				}
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

		// The email goes to providers only when identify is on and its traits
		// include the email; `pii: false` routing keeps it from a provider.
		const email =
			emission.withEmail && user
				? typeof traits?.email === "string"
					? traits.email
					: options.identify === undefined || options.identify === true
						? (user.email ?? undefined)
						: undefined
				: undefined;
		const trackOptions: Record<string, unknown> = {};
		if (emission.userId) trackOptions.userId = emission.userId;
		if (emission.sessionId) trackOptions.sessionId = emission.sessionId;
		if (email && emission.userId) {
			trackOptions.user = { userId: emission.userId, email };
		}
		if (emission.request && options.requestContext !== false) {
			trackOptions.context = { server: { ...emission.request } };
		}

		await analytics.track(authEvents[key].name, properties, trackOptions);
	}

	function emit(
		key: AuthEventKey,
		emission: Emission | (() => Promise<Emission | undefined>),
	): void {
		if (!isOn(key)) return;
		runInBackground(
			async () => {
				const resolved =
					typeof emission === "function" ? await emission() : emission;
				if (resolved) await send(key, resolved);
			},
			authContext?.options,
			reportError,
		);
	}

	const requestOf = (ctx: EndpointContext | undefined) =>
		options.requestContext === false ? undefined : requestInfo(ctx);

	const actorOf = (ctx: EndpointContext | undefined, subject?: string) => {
		const actor = ctx?.context.session?.user?.id;
		return actor && actor !== subject ? { actorUserId: actor } : {};
	};

	// ---------------------------------------------------------------------
	// Database hooks: run after the transaction commits (Better Auth >= 1.5)
	// ---------------------------------------------------------------------

	const onUserCreated = (user: AuthUser, ctx: EndpointContext | undefined) =>
		guard(() => {
			// Users created outside an endpoint (seed scripts, migrations) are
			// not sign-ups.
			if (!ctx) return;
			stateOf(ctx)?.createdUsers.add(user.id);
			if (user.isAnonymous) {
				emit("anonymousUserCreated", {
					userId: user.id,
					properties: {},
					request: requestOf(ctx),
				});
				return;
			}
			if (ctx.path === "/admin/create-user") return;
			const method: SignInMethod = signInMethod(ctx) ?? { method: "unknown" };
			emit("userSignedUp", {
				userId: user.id,
				properties: {
					method: method.method,
					...(method.provider && { provider: method.provider }),
					emailVerified: user.emailVerified === true,
				},
				user,
				withEmail: true,
				request: requestOf(ctx),
			});
		});

	const onUserUpdating = (
		data: Record<string, unknown>,
		ctx: EndpointContext | undefined,
	) =>
		guard(() => {
			stateOf(ctx)?.userUpdates.push(new Set(Object.keys(data ?? {})));
		});

	const onUserUpdated = (user: AuthUser, ctx: EndpointContext | undefined) =>
		guard(() => {
			if (!ctx || typeof user !== "object" || user === null) return;
			const changed = stateOf(ctx)?.userUpdates.shift();
			if (!changed || user.isAnonymous) return;
			const request = requestOf(ctx);
			let identified = false;
			const once = () => {
				const first = !identified;
				identified = true;
				return first;
			};

			if (changed.has("email")) {
				emit("emailChanged", {
					userId: user.id,
					properties: { emailVerified: user.emailVerified === true },
					user,
					identify: once(),
					request,
				});
			} else if (changed.has("emailVerified") && user.emailVerified === true) {
				emit("emailVerified", {
					userId: user.id,
					properties: {},
					user,
					identify: once(),
					request,
				});
			}
			if (changed.has("twoFactorEnabled")) {
				emit(user.twoFactorEnabled ? "twoFactorEnabled" : "twoFactorDisabled", {
					userId: user.id,
					properties: {},
					request,
				});
			}
			if (
				changed.has("phoneNumberVerified") &&
				user.phoneNumberVerified === true
			) {
				emit("phoneNumberVerified", {
					userId: user.id,
					properties: {},
					request,
				});
			}
			if (ctx.path === "/update-user" || ctx.path === "/admin/update-user") {
				const fields = [...changed].filter(
					(field) =>
						!["id", "updatedAt", "email", "emailVerified"].includes(field),
				);
				if (fields.length > 0) {
					emit("userProfileUpdated", {
						userId: user.id,
						properties: { fields, ...actorOf(ctx, user.id) },
						user,
						identify: once(),
						request,
					});
				}
			}
		});

	const onUserDeleted = (user: AuthUser, ctx: EndpointContext | undefined) =>
		guard(() => {
			if (user.isAnonymous) {
				// Better Auth deletes the anonymous user once it is linked.
				const state = signInMethod(ctx) ? stateOf(ctx) : undefined;
				if (state) state.linkedAnonymousUserId ??= user.id;
				return;
			}
			const path = ctx?.path;
			const deletedBy = !ctx
				? "server"
				: path === "/admin/remove-user"
					? "admin"
					: path?.startsWith("/delete-user")
						? "self"
						: "server";
			emit("userDeleted", {
				userId: user.id,
				properties: {
					deletedBy,
					...(deletedBy === "admin" ? actorOf(ctx, user.id) : {}),
				},
				request: requestOf(ctx),
			});
		});

	const onAccountCreated = (
		account: { userId: string; providerId: string },
		ctx: EndpointContext | undefined,
	) =>
		guard(() => {
			if (!ctx) return;
			if (stateOf(ctx)?.createdUsers.has(account.userId)) return;
			emit("accountLinked", {
				userId: account.userId,
				properties: { provider: account.providerId },
				request: requestOf(ctx),
			});
		});

	const onAccountDeleted = (
		account: { userId: string; providerId: string },
		ctx: EndpointContext | undefined,
	) =>
		guard(() => {
			if (ctx?.path !== "/unlink-account") return;
			emit("accountUnlinked", {
				userId: account.userId,
				properties: { provider: account.providerId },
				request: requestOf(ctx),
			});
		});

	// ---------------------------------------------------------------------
	// After hooks: endpoints whose writes bypass the database hooks
	// ---------------------------------------------------------------------

	const onSignIn = (ctx: EndpointContext, method: SignInMethod) => {
		const newSession = ctx.context.newSession;
		if (!newSession?.user?.id) return;
		const returned = ctx.context.returned;
		if (objectField(returned, "twoFactorRedirect")) return;

		const { user, session } = newSession;
		const state = stateOf(ctx);
		const request = requestOf(ctx);
		if (
			state?.linkedAnonymousUserId &&
			state.linkedAnonymousUserId !== user.id
		) {
			emit("anonymousUserLinked", {
				userId: user.id,
				properties: { anonymousUserId: state.linkedAnonymousUserId },
				request,
			});
			state.linkedAnonymousUserId = undefined;
		}
		// A sign-up already reported this user.
		if (state?.createdUsers.has(user.id) || user.isAnonymous) return;
		// Re-verifying while signed in as the same user (such as confirming a
		// new second factor) refreshes the session; it is not a sign-in.
		if (ctx.context.session?.user?.id === user.id) return;

		emit("userSignedIn", {
			userId: user.id,
			sessionId: session?.id,
			properties: {
				method: method.method,
				...(method.provider && { provider: method.provider }),
				twoFactor: method.method === "two_factor",
			},
			user,
			request,
		});
	};

	const onAfter = (ctx: EndpointContext) => {
		const returned = ctx.context.returned;
		if (!succeeded(returned)) return;

		const method = signInMethod(ctx);
		if (method) {
			onSignIn(ctx, method);
			return;
		}

		const path = ctx.path ?? "";
		const sessionUserId = ctx.context.session?.user?.id;
		const body = (ctx.body ?? {}) as Record<string, unknown>;
		const request = requestOf(ctx);

		switch (path) {
			case "/sign-out": {
				const signingOut = stateOf(ctx)?.signingOut;
				if (!signingOut) return;
				emit("userSignedOut", {
					userId: signingOut.userId,
					sessionId: signingOut.sessionId,
					properties: {},
					request,
				});
				return;
			}
			case "/revoke-session":
			case "/revoke-sessions":
			case "/revoke-other-sessions": {
				if (!sessionUserId) return;
				const scope =
					path === "/revoke-session"
						? "one"
						: path === "/revoke-sessions"
							? "all"
							: "others";
				emit("sessionsRevoked", {
					userId: sessionUserId,
					properties: { scope },
					request,
				});
				return;
			}
			case "/change-password": {
				const userId =
					sessionUserId ?? stringField(objectField(returned, "user"), "id");
				if (!userId) return;
				emit("passwordChanged", {
					userId,
					properties: {
						revokedOtherSessions: body.revokeOtherSessions === true,
					},
					request,
				});
				return;
			}
			case "/api-key/create":
			case "/api-key/update": {
				const apiKeyId = stringField(returned, "id");
				const userId =
					sessionUserId ??
					stringField(returned, "userId") ??
					stringField(returned, "referenceId");
				if (!apiKeyId || !userId) return;
				if (path === "/api-key/create") {
					const name = stringField(returned, "name");
					const prefix = stringField(returned, "prefix");
					const expiresAt = isoDate(objectField(returned, "expiresAt"));
					emit("apiKeyCreated", {
						userId,
						properties: {
							apiKeyId,
							...(name && { name }),
							...(prefix && { prefix }),
							...(expiresAt && { expiresAt }),
						},
						request,
					});
				} else {
					const enabled = objectField(returned, "enabled");
					emit("apiKeyUpdated", {
						userId,
						properties: {
							apiKeyId,
							...(typeof enabled === "boolean" && { enabled }),
						},
						request,
					});
				}
				return;
			}
			case "/api-key/delete": {
				const apiKeyId = stringField(body, "keyId");
				const userId = sessionUserId ?? stringField(body, "userId");
				if (!apiKeyId || !userId) return;
				emit("apiKeyDeleted", {
					userId,
					properties: { apiKeyId },
					request,
				});
				return;
			}
			case "/admin/ban-user":
			case "/admin/unban-user":
			case "/admin/set-role":
			case "/admin/create-user": {
				const user = objectField(returned, "user") as AuthUser | undefined;
				const userId = stringField(user, "id") ?? stringField(body, "userId");
				if (!userId) return;
				const actor = actorOf(ctx, userId);
				if (path === "/admin/ban-user") {
					const expiresAt = isoDate(objectField(user, "banExpires"));
					emit("userBanned", {
						userId,
						properties: { ...actor, ...(expiresAt && { expiresAt }) },
						request,
					});
				} else if (path === "/admin/unban-user") {
					emit("userUnbanned", { userId, properties: actor, request });
				} else if (path === "/admin/set-role") {
					const role = stringField(user, "role") ?? roleString(body.role);
					if (!role) return;
					emit("userRoleChanged", {
						userId,
						properties: { ...actor, role },
						request,
					});
				} else {
					const role = stringField(user, "role");
					emit("userCreatedByAdmin", {
						userId,
						properties: { ...actor, ...(role && { role }) },
						user,
						request,
					});
				}
				return;
			}
			case "/admin/impersonate-user": {
				const userId =
					stringField(objectField(returned, "user"), "id") ??
					stringField(body, "userId");
				if (!userId) return;
				emit("impersonationStarted", {
					userId,
					properties: actorOf(ctx, userId),
					request,
				});
				return;
			}
			case "/admin/stop-impersonating": {
				// The request still carries the impersonation session.
				const session = ctx.context.session;
				const userId = session?.user?.id;
				const actorUserId = session?.session?.impersonatedBy ?? undefined;
				if (!userId) return;
				emit("impersonationStopped", {
					userId,
					properties: actorUserId ? { actorUserId } : {},
					request,
				});
				return;
			}
			case "/passkey/verify-registration": {
				const passkeyId = stringField(returned, "id");
				const userId = sessionUserId ?? stringField(returned, "userId");
				if (!passkeyId || !userId) return;
				const deviceType = stringField(returned, "deviceType");
				emit("passkeyAdded", {
					userId,
					properties: { passkeyId, ...(deviceType && { deviceType }) },
					request,
				});
				return;
			}
			case "/passkey/delete-passkey": {
				const passkeyId = stringField(body, "id");
				if (!passkeyId || !sessionUserId) return;
				emit("passkeyRemoved", {
					userId: sessionUserId,
					properties: { passkeyId },
					request,
				});
				return;
			}
			case "/sso/register": {
				const ssoProviderId =
					stringField(returned, "providerId") ??
					stringField(body, "providerId");
				const userId = sessionUserId ?? stringField(returned, "userId");
				if (!ssoProviderId || !userId) return;
				const type =
					objectField(returned, "samlConfig") || body.samlConfig
						? "saml"
						: objectField(returned, "oidcConfig") || body.oidcConfig
							? "oidc"
							: undefined;
				const organizationId =
					stringField(returned, "organizationId") ??
					stringField(body, "organizationId");
				emit("ssoProviderRegistered", {
					userId,
					properties: {
						ssoProviderId,
						...(type && { type }),
						...(organizationId && { organizationId }),
					},
					request,
				});
				return;
			}
			case "/organization/leave": {
				const memberId = stringField(returned, "id");
				const organizationId = stringField(returned, "organizationId");
				const role = stringField(returned, "role");
				const userId = stringField(returned, "userId") ?? sessionUserId;
				if (!memberId || !organizationId || !userId) return;
				emit("organizationMemberRemoved", {
					userId,
					properties: {
						organizationId,
						memberId,
						...(role && { role }),
						reason: "left",
					},
					request,
				});
				return;
			}
			case "/sso/delete-provider": {
				const ssoProviderId = stringField(body, "providerId");
				if (!ssoProviderId || !sessionUserId) return;
				emit("ssoProviderDeleted", {
					userId: sessionUserId,
					properties: { ssoProviderId },
					request,
				});
				return;
			}
		}
	};

	// ---------------------------------------------------------------------
	// Plugin option callbacks, wrapped at init
	// ---------------------------------------------------------------------

	/**
	 * Chains `handler` after the existing callback at `target[name]`. The
	 * callback's own result and errors pass through unchanged; `handler`
	 * never throws.
	 */
	function wrap(
		target: Record<string, unknown> | undefined,
		name: string,
		handler: (...args: unknown[]) => void,
	): void {
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
	}

	function wrapOrganization(organization: PluginLike | undefined): void {
		const pluginOptions = organization?.options;
		if (!pluginOptions) return;
		pluginOptions.organizationHooks ??= {};
		const hooks = pluginOptions.organizationHooks as Record<string, unknown>;
		type Org = { id: string; slug?: string; name?: string };
		type Member = { id: string; userId: string; role: string };
		const ids = (data: unknown) => data as Record<string, unknown>;
		const orgOf = (data: unknown) => ids(data).organization as Org | undefined;

		const organizationEvent =
			(key: AuthEventKey, extra?: (org: Org) => Record<string, unknown>) =>
			(data: unknown) => {
				const org = orgOf(data);
				const ctx = currentEndpointContext();
				const userId =
					stringField(ids(data).user, "id") ?? ctx?.context.session?.user?.id;
				if (!org?.id || !userId) return;
				emit(key, {
					userId,
					properties: { organizationId: org.id, ...extra?.(org) },
					request: requestOf(ctx),
				});
			};

		wrap(
			hooks,
			"afterCreateOrganization",
			organizationEvent("organizationCreated", (org) => ({
				...(org.slug && { slug: org.slug }),
				...(org.name && { name: org.name }),
			})),
		);
		wrap(
			hooks,
			"afterUpdateOrganization",
			organizationEvent("organizationUpdated"),
		);
		wrap(
			hooks,
			"afterDeleteOrganization",
			organizationEvent("organizationDeleted"),
		);

		const memberEvent =
			(
				key: AuthEventKey,
				extra?: (
					data: Record<string, unknown>,
					ctx?: EndpointContext,
				) => Record<string, unknown> | undefined,
			) =>
			(data: unknown) => {
				const ctx = currentEndpointContext();
				const member = ids(data).member as Member | undefined;
				const org = orgOf(data);
				if (!member?.userId || !org?.id) return;
				const more = extra?.(ids(data), ctx);
				if (more === undefined && extra) return;
				emit(key, {
					userId: member.userId,
					properties: {
						organizationId: org.id,
						memberId: member.id,
						role: member.role,
						...actorOf(ctx, member.userId),
						...more,
					},
					request: requestOf(ctx),
				});
			};

		wrap(
			hooks,
			"afterAddMember",
			memberEvent("organizationMemberAdded", (_data, ctx) =>
				// The creator joins as a member while creating the organization.
				ctx?.path === "/organization/create" ? undefined : {},
			),
		);
		wrap(
			hooks,
			"afterRemoveMember",
			// Leaving is reported by the after hook on /organization/leave.
			memberEvent("organizationMemberRemoved", (_data, ctx) =>
				ctx?.path === "/organization/leave" ? undefined : { reason: "removed" },
			),
		);
		wrap(
			hooks,
			"afterUpdateMemberRole",
			memberEvent("organizationMemberRoleUpdated", (data) => {
				const previousRole = data.previousRole;
				return typeof previousRole === "string" ? { previousRole } : {};
			}),
		);

		const invitationEvent =
			(key: AuthEventKey, actorField: string, withMember = false) =>
			(data: unknown) => {
				const ctx = currentEndpointContext();
				const invitation = ids(data).invitation as
					| { id: string; role?: string }
					| undefined;
				const org = orgOf(data);
				const userId =
					stringField(ids(data)[actorField], "id") ??
					ctx?.context.session?.user?.id;
				if (!invitation?.id || !org?.id || !userId) return;
				const member = ids(data).member as Member | undefined;
				if (withMember && !member?.id) return;
				emit(key, {
					userId,
					properties: {
						organizationId: org.id,
						invitationId: invitation.id,
						...(key === "organizationInvitationSent" &&
							invitation.role && { role: invitation.role }),
						...(withMember &&
							member && { memberId: member.id, role: member.role }),
					},
					request: requestOf(ctx),
				});
			};

		wrap(
			hooks,
			"afterCreateInvitation",
			invitationEvent("organizationInvitationSent", "inviter"),
		);
		wrap(
			hooks,
			"afterAcceptInvitation",
			invitationEvent("organizationInvitationAccepted", "user", true),
		);
		wrap(
			hooks,
			"afterRejectInvitation",
			invitationEvent("organizationInvitationRejected", "user"),
		);
		wrap(
			hooks,
			"afterCancelInvitation",
			invitationEvent("organizationInvitationCanceled", "cancelledBy"),
		);

		const teamEvent =
			(key: AuthEventKey, memberField?: string) => (data: unknown) => {
				const ctx = currentEndpointContext();
				// The default team is part of creating the organization.
				if (ctx?.path === "/organization/create") return;
				const team = ids(data).team as
					| { id: string; organizationId?: string }
					| undefined;
				const org = orgOf(data);
				const organizationId = org?.id ?? team?.organizationId;
				const subject = memberField
					? stringField(ids(data)[memberField], "userId")
					: undefined;
				const userId =
					subject ??
					stringField(ids(data).user, "id") ??
					ctx?.context.session?.user?.id;
				if (!team?.id || !organizationId || !userId) return;
				emit(key, {
					userId,
					properties: {
						organizationId,
						teamId: team.id,
						...(memberField ? actorOf(ctx, userId) : {}),
					},
					request: requestOf(ctx),
				});
			};

		wrap(hooks, "afterCreateTeam", teamEvent("organizationTeamCreated"));
		wrap(hooks, "afterDeleteTeam", teamEvent("organizationTeamDeleted"));
		wrap(
			hooks,
			"afterAddTeamMember",
			teamEvent("organizationTeamMemberAdded", "teamMember"),
		);
		wrap(
			hooks,
			"afterRemoveTeamMember",
			teamEvent("organizationTeamMemberRemoved", "teamMember"),
		);
	}

	function wrapStripe(stripe: PluginLike | undefined): void {
		const subscription = stripe?.options?.subscription as
			| Record<string, unknown>
			| undefined;
		if (!subscription) return;

		type Subscription = {
			id: string;
			plan?: string;
			status?: string;
			referenceId?: string;
			billingInterval?: string | null;
			trialStart?: unknown;
		};

		const subscriptionEvent =
			(key: AuthEventKey, started = false) =>
			(data: unknown) => {
				const row = (data as { subscription?: Subscription } | undefined)
					?.subscription;
				if (!row?.id || !row.referenceId) return;
				const request = requestOf(currentEndpointContext());
				emit(key, async () => {
					// A subscription belongs to a user or to an organization.
					const referenceId = row.referenceId as string;
					const user =
						await authContext?.internalAdapter?.findUserById?.(referenceId);
					const owner = user
						? { userId: referenceId }
						: { organizationId: referenceId };
					return {
						userId: owner.userId,
						properties: {
							subscriptionId: row.id,
							plan: row.plan ?? "unknown",
							...(row.status && { status: row.status }),
							...(owner.organizationId && {
								organizationId: owner.organizationId,
							}),
							...(started && {
								...(row.billingInterval && { interval: row.billingInterval }),
								trial: Boolean(row.trialStart),
							}),
						},
						request,
					};
				});
			};

		wrap(
			subscription,
			"onSubscriptionComplete",
			subscriptionEvent("subscriptionStarted", true),
		);
		wrap(
			subscription,
			"onSubscriptionCreated",
			subscriptionEvent("subscriptionStarted", true),
		);
		wrap(
			subscription,
			"onSubscriptionUpdate",
			subscriptionEvent("subscriptionUpdated"),
		);
		wrap(
			subscription,
			"onSubscriptionCancel",
			subscriptionEvent("subscriptionCanceled"),
		);
		wrap(
			subscription,
			"onSubscriptionDeleted",
			subscriptionEvent("subscriptionEnded"),
		);
	}

	function wrapAnonymous(anonymous: PluginLike | undefined): void {
		// Covers `disableDeleteAnonymousUser`, where no deletion reveals the link.
		wrap(anonymous?.options, "onLinkAccount", (data) => {
			const link = data as {
				anonymousUser?: { user?: { id?: string } };
				ctx?: EndpointContext;
			};
			const anonymousUserId = link.anonymousUser?.user?.id;
			const state = stateOf(link.ctx ?? currentEndpointContext());
			if (state && anonymousUserId)
				state.linkedAnonymousUserId = anonymousUserId;
		});
	}

	function wrapPasswordReset(
		emailAndPassword: Record<string, unknown> | undefined,
	): void {
		wrap(emailAndPassword, "onPasswordReset", (data) => {
			const user = (data as { user?: AuthUser } | undefined)?.user;
			if (!user?.id) return;
			emit("passwordReset", {
				userId: user.id,
				properties: {},
				request: requestOf(currentEndpointContext()),
			});
		});
	}

	function activate(ctx: AuthContextLike): Set<AuthEventKey> {
		const plugins = ctx.options.plugins ?? [];
		const installed = new Set(plugins.map((plugin) => plugin.id));
		const available = (key: AuthEventKey) => {
			const required = authEventDefaults[key].plugin;
			return !required || installed.has(required);
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
			} else if (!available(key)) {
				warnOnce(
					`missing:${key}`,
					`Ignoring "${key}": it needs the Better Auth "${authEventDefaults[key].plugin}" plugin, which is not installed.`,
				);
			}
		}

		const include = options.include ? new Set(options.include) : undefined;
		const exclude = new Set(options.exclude ?? []);
		return new Set(
			authEventKeys.filter(
				(key) =>
					available(key) &&
					(!include || include.has(key)) &&
					!exclude.has(key) &&
					options.events?.[key] !== false,
			),
		);
	}

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

				const find = (id: string) => plugins.find((entry) => entry.id === id);
				wrapOrganization(find("organization"));
				wrapStripe(find("stripe"));
				wrapAnonymous(find("anonymous"));
				wrapPasswordReset(context.options.emailAndPassword);
			} catch (error) {
				reportError(error);
			}

			return {
				options: {
					databaseHooks: {
						user: {
							create: {
								after: async (user: AuthUser, ctx?: EndpointContext | null) =>
									onUserCreated(user, ctx ?? undefined),
							},
							update: {
								before: async (
									data: Record<string, unknown>,
									ctx?: EndpointContext | null,
								) => {
									// Returning nothing leaves the write untouched.
									onUserUpdating(data, ctx ?? undefined);
								},
								after: async (user: AuthUser, ctx?: EndpointContext | null) =>
									onUserUpdated(user, ctx ?? undefined),
							},
							delete: {
								after: async (user: AuthUser, ctx?: EndpointContext | null) =>
									onUserDeleted(user, ctx ?? undefined),
							},
						},
						account: {
							create: {
								after: async (
									account: { userId: string; providerId: string },
									ctx?: EndpointContext | null,
								) => onAccountCreated(account, ctx ?? undefined),
							},
							delete: {
								after: async (
									account: { userId: string; providerId: string },
									ctx?: EndpointContext | null,
								) => onAccountDeleted(account, ctx ?? undefined),
							},
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
						(afterPaths.has(ctx.path) ||
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

function roleString(role: unknown): string | undefined {
	if (typeof role === "string") return role;
	if (Array.isArray(role) && role.every((entry) => typeof entry === "string")) {
		return role.join(",");
	}
	return undefined;
}
