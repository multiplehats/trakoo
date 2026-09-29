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
import { field, isoDate, record, stringField } from "./fields.js";
import { type SignInMethod, signInMethod } from "./methods.js";
import {
	type AuthSession,
	type AuthUser,
	type EndpointContext,
	type RequestInfo,
	currentEndpointContext,
	requestInfo,
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
	/** Defaults to the request's session of `userId`, when it has one. */
	sessionId?: string;
	properties: Record<string, unknown>;
	/** Identify this user first, when the event identifies. */
	user?: AuthUser;
	/** Attach the user's email to the event (sign-up only). */
	withEmail?: boolean;
	identify?: boolean;
}

/** An after hook's view of the call it follows. */
interface AfterCall {
	ctx: EndpointContext;
	returned: unknown;
	body: Record<string, unknown>;
	/** The signed-in user making the request. */
	sessionUserId: string | undefined;
}

/** The account fields the plugin reads. */
interface AccountRow {
	userId: string;
	providerId: string;
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

/** The signed-in user making the request. */
function sessionUserIdOf(ctx: EndpointContext | undefined): string | undefined {
	return ctx?.context.session?.user?.id;
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
					Promise.resolve(analytics.identify(emission.userId, traits)),
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

	/**
	 * Sends `key` in the background. What the event needs from the request is
	 * read now, while the request is still at this point.
	 */
	function emit(
		key: AuthEventKey,
		ctx: EndpointContext | undefined,
		emission: Emission | (() => Promise<Emission | undefined>),
	): void {
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
	}

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

	const actorOf = (ctx: EndpointContext | undefined, subject?: string) => {
		const actor = sessionUserIdOf(ctx);
		return actor && actor !== subject ? { actorUserId: actor } : {};
	};

	// ---------------------------------------------------------------------
	// Database hooks: run after the transaction commits (Better Auth >= 1.7)
	// ---------------------------------------------------------------------

	const onUserCreated = (user: AuthUser, ctx: EndpointContext | undefined) =>
		guard(() => {
			// Users created outside an endpoint (seed scripts, migrations) are
			// not sign-ups.
			if (!ctx) return;
			stateOf(ctx)?.createdUsers.add(user.id);
			if (user.isAnonymous) {
				emit("anonymousUserCreated", ctx, { userId: user.id, properties: {} });
				return;
			}
			if (ctx.path === "/admin/create-user") return;
			emit("userSignedUp", ctx, {
				userId: user.id,
				properties: {
					...(signInMethod(ctx) ?? { method: "unknown" }),
					emailVerified: user.emailVerified === true,
				},
				user,
				withEmail: true,
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
			// Pairs with the before hook, even for an update that returns no row.
			const changed = stateOf(ctx)?.userUpdates.shift();
			if (!ctx || typeof user !== "object" || user === null) return;
			if (!changed || user.isAnonymous) return;
			let identified = false;
			const once = () => {
				const first = !identified;
				identified = true;
				return first;
			};

			if (changed.has("email")) {
				emit("emailChanged", ctx, {
					userId: user.id,
					properties: { emailVerified: user.emailVerified === true },
					user,
					identify: once(),
				});
			} else if (changed.has("emailVerified") && user.emailVerified === true) {
				emit("emailVerified", ctx, {
					userId: user.id,
					properties: {},
					user,
					identify: once(),
				});
			}
			if (changed.has("twoFactorEnabled")) {
				emit(
					user.twoFactorEnabled ? "twoFactorEnabled" : "twoFactorDisabled",
					ctx,
					{ userId: user.id, properties: {} },
				);
			}
			if (
				changed.has("phoneNumberVerified") &&
				user.phoneNumberVerified === true
			) {
				emit("phoneNumberVerified", ctx, { userId: user.id, properties: {} });
			}
			if (ctx.path === "/update-user" || ctx.path === "/admin/update-user") {
				const fields = [...changed].filter(
					(name) =>
						!["id", "updatedAt", "email", "emailVerified"].includes(name),
				);
				if (fields.length > 0) {
					emit("userProfileUpdated", ctx, {
						userId: user.id,
						properties: { fields, ...actorOf(ctx, user.id) },
						user,
						identify: once(),
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
			const deletedBy = deletedByOf(ctx?.path);
			emit("userDeleted", ctx, {
				userId: user.id,
				properties: {
					deletedBy,
					...(deletedBy === "admin" ? actorOf(ctx, user.id) : {}),
				},
			});
		});

	const onAccountCreated = (
		account: AccountRow,
		ctx: EndpointContext | undefined,
	) =>
		guard(() => {
			if (!ctx) return;
			if (stateOf(ctx)?.createdUsers.has(account.userId)) return;
			emit("accountLinked", ctx, {
				userId: account.userId,
				properties: { provider: account.providerId },
			});
		});

	const onAccountDeleted = (
		account: AccountRow,
		ctx: EndpointContext | undefined,
	) =>
		guard(() => {
			if (ctx?.path !== "/unlink-account") return;
			emit("accountUnlinked", ctx, {
				userId: account.userId,
				properties: { provider: account.providerId },
			});
		});

	// ---------------------------------------------------------------------
	// After hooks: endpoints whose writes bypass the database hooks
	// ---------------------------------------------------------------------

	const onSignIn = (ctx: EndpointContext, method: SignInMethod) => {
		const newSession = ctx.context.newSession;
		if (!newSession?.user?.id) return;
		if (field(ctx.context.returned, "twoFactorRedirect")) return;

		const { user } = newSession;
		const state = stateOf(ctx);
		if (
			state?.linkedAnonymousUserId &&
			state.linkedAnonymousUserId !== user.id
		) {
			emit("anonymousUserLinked", ctx, {
				userId: user.id,
				properties: { anonymousUserId: state.linkedAnonymousUserId },
			});
			state.linkedAnonymousUserId = undefined;
		}
		// A sign-up already reported this user.
		if (state?.createdUsers.has(user.id) || user.isAnonymous) return;
		// Re-verifying while signed in as the same user (such as confirming a
		// new second factor) refreshes the session; it is not a sign-in.
		if (sessionUserIdOf(ctx) === user.id) return;

		emit("userSignedIn", ctx, {
			userId: user.id,
			properties: { ...method },
			user,
		});
	};

	const sessionsRevoked =
		(scope: "one" | "all" | "others") =>
		({ ctx, sessionUserId }: AfterCall) => {
			if (!sessionUserId) return;
			emit("sessionsRevoked", ctx, {
				userId: sessionUserId,
				properties: { scope },
			});
		};

	/**
	 * The user an API key call acts for: the signed-in user, or the `userId` a
	 * server call passes. The key's `referenceId` is not it: an organization's
	 * key references the organization.
	 */
	const apiKeyUserOf = ({ body, sessionUserId }: AfterCall) =>
		sessionUserId ?? stringField(body, "userId");

	/** The user an admin endpoint acted on. */
	const adminSubjectOf = ({ returned, body }: AfterCall) => {
		const user = field(returned, "user") as AuthUser | undefined;
		return {
			user,
			userId: stringField(user, "id") ?? stringField(body, "userId"),
		};
	};

	/** What each endpoint reports once it succeeds. */
	const afterHandlers = new Map<string, (call: AfterCall) => void>([
		[
			"/sign-out",
			({ ctx }) => {
				const signingOut = stateOf(ctx)?.signingOut;
				if (!signingOut) return;
				emit("userSignedOut", ctx, {
					userId: signingOut.userId,
					sessionId: signingOut.sessionId,
					properties: {},
				});
			},
		],
		["/revoke-session", sessionsRevoked("one")],
		["/revoke-sessions", sessionsRevoked("all")],
		["/revoke-other-sessions", sessionsRevoked("others")],
		[
			"/change-password",
			({ ctx, returned, body, sessionUserId }) => {
				const userId =
					sessionUserId ?? stringField(field(returned, "user"), "id");
				if (!userId) return;
				emit("passwordChanged", ctx, {
					userId,
					properties: {
						revokedOtherSessions: body.revokeOtherSessions === true,
					},
				});
			},
		],
		[
			"/api-key/create",
			(call) => {
				const { ctx, returned, body } = call;
				const apiKeyId = stringField(returned, "id");
				const userId = apiKeyUserOf(call);
				if (!apiKeyId || !userId) return;
				const name = stringField(returned, "name");
				const prefix = stringField(returned, "prefix");
				const expiresAt = isoDate(field(returned, "expiresAt"));
				const organizationId = stringField(body, "organizationId");
				// Only an organization's key references the organization.
				const ownedByOrganization =
					organizationId !== undefined &&
					stringField(returned, "referenceId") === organizationId;
				emit("apiKeyCreated", ctx, {
					userId,
					properties: {
						apiKeyId,
						...(name && { name }),
						...(prefix && { prefix }),
						...(expiresAt && { expiresAt }),
						...(ownedByOrganization && { organizationId }),
					},
				});
			},
		],
		[
			"/api-key/update",
			(call) => {
				const apiKeyId = stringField(call.returned, "id");
				const userId = apiKeyUserOf(call);
				if (!apiKeyId || !userId) return;
				const enabled = field(call.returned, "enabled");
				emit("apiKeyUpdated", call.ctx, {
					userId,
					properties: {
						apiKeyId,
						...(typeof enabled === "boolean" && { enabled }),
					},
				});
			},
		],
		[
			"/api-key/delete",
			(call) => {
				const apiKeyId = stringField(call.body, "keyId");
				const userId = apiKeyUserOf(call);
				if (!apiKeyId || !userId) return;
				emit("apiKeyDeleted", call.ctx, { userId, properties: { apiKeyId } });
			},
		],
		[
			"/admin/ban-user",
			(call) => {
				const { user, userId } = adminSubjectOf(call);
				if (!userId) return;
				const expiresAt = isoDate(field(user, "banExpires"));
				emit("userBanned", call.ctx, {
					userId,
					properties: {
						...actorOf(call.ctx, userId),
						...(expiresAt && { expiresAt }),
					},
				});
			},
		],
		[
			"/admin/unban-user",
			(call) => {
				const { userId } = adminSubjectOf(call);
				if (!userId) return;
				emit("userUnbanned", call.ctx, {
					userId,
					properties: actorOf(call.ctx, userId),
				});
			},
		],
		[
			"/admin/set-role",
			(call) => {
				const { user, userId } = adminSubjectOf(call);
				const role = stringField(user, "role") ?? roleString(call.body.role);
				if (!userId || !role) return;
				emit("userRoleChanged", call.ctx, {
					userId,
					properties: { ...actorOf(call.ctx, userId), role },
				});
			},
		],
		[
			"/admin/create-user",
			(call) => {
				const { user, userId } = adminSubjectOf(call);
				if (!userId) return;
				const role = stringField(user, "role");
				emit("userCreatedByAdmin", call.ctx, {
					userId,
					properties: { ...actorOf(call.ctx, userId), ...(role && { role }) },
					user,
				});
			},
		],
		[
			"/admin/impersonate-user",
			(call) => {
				const { userId } = adminSubjectOf(call);
				if (!userId) return;
				emit("userImpersonationStarted", call.ctx, {
					userId,
					properties: actorOf(call.ctx, userId),
				});
			},
		],
		[
			"/admin/stop-impersonating",
			({ ctx }) => {
				// The request still carries the impersonation session.
				const session = ctx.context.session;
				const userId = session?.user?.id;
				const actorUserId = session?.session?.impersonatedBy ?? undefined;
				if (!userId) return;
				emit("userImpersonationStopped", ctx, {
					userId,
					properties: actorUserId ? { actorUserId } : {},
				});
			},
		],
		[
			"/passkey/verify-registration",
			({ ctx, returned, sessionUserId }) => {
				const passkeyId = stringField(returned, "id");
				const userId = sessionUserId ?? stringField(returned, "userId");
				if (!passkeyId || !userId) return;
				const deviceType = stringField(returned, "deviceType");
				emit("passkeyAdded", ctx, {
					userId,
					properties: { passkeyId, ...(deviceType && { deviceType }) },
				});
			},
		],
		[
			"/passkey/delete-passkey",
			({ ctx, body, sessionUserId }) => {
				const passkeyId = stringField(body, "id");
				if (!passkeyId || !sessionUserId) return;
				emit("passkeyRemoved", ctx, {
					userId: sessionUserId,
					properties: { passkeyId },
				});
			},
		],
		[
			"/sso/register",
			({ ctx, returned, body, sessionUserId }) => {
				const ssoProviderId =
					stringField(returned, "providerId") ??
					stringField(body, "providerId");
				const userId = sessionUserId ?? stringField(returned, "userId");
				if (!ssoProviderId || !userId) return;
				const type =
					field(returned, "samlConfig") || body.samlConfig
						? "saml"
						: field(returned, "oidcConfig") || body.oidcConfig
							? "oidc"
							: undefined;
				const organizationId =
					stringField(returned, "organizationId") ??
					stringField(body, "organizationId");
				emit("ssoProviderRegistered", ctx, {
					userId,
					properties: {
						ssoProviderId,
						...(type && { type }),
						...(organizationId && { organizationId }),
					},
				});
			},
		],
		[
			"/sso/delete-provider",
			({ ctx, body, sessionUserId }) => {
				const ssoProviderId = stringField(body, "providerId");
				if (!ssoProviderId || !sessionUserId) return;
				emit("ssoProviderDeleted", ctx, {
					userId: sessionUserId,
					properties: { ssoProviderId },
				});
			},
		],
		[
			"/organization/leave",
			({ ctx, returned, sessionUserId }) => {
				const memberId = stringField(returned, "id");
				const organizationId = stringField(returned, "organizationId");
				const role = stringField(returned, "role");
				const userId = stringField(returned, "userId") ?? sessionUserId;
				if (!memberId || !organizationId || !userId) return;
				emit("organizationMemberRemoved", ctx, {
					userId,
					properties: {
						organizationId,
						memberId,
						...(role && { role }),
						reason: "left",
					},
				});
			},
		],
	]);

	const onAfter = (ctx: EndpointContext) => {
		const returned = ctx.context.returned;
		if (!succeeded(returned)) return;

		const method = signInMethod(ctx);
		if (method) {
			onSignIn(ctx, method);
			return;
		}

		const handler = ctx.path ? afterHandlers.get(ctx.path) : undefined;
		handler?.({
			ctx,
			returned,
			body: record(ctx.body),
			sessionUserId: sessionUserIdOf(ctx),
		});
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
		type Report = Pick<Emission, "userId" | "properties"> | undefined;
		type Reader = (
			data: Record<string, unknown>,
			ctx: EndpointContext | undefined,
		) => Report;

		/** Reports `key` after the organization hook `name`, when `read` finds one. */
		const on = (name: string, key: AuthEventKey, read: Reader) =>
			wrap(hooks, name, (data) => {
				const ctx = currentEndpointContext();
				const report = read(record(data), ctx);
				if (report?.userId) emit(key, ctx, report);
			});

		const orgOf = (data: Record<string, unknown>) =>
			data.organization as Org | undefined;

		// Organization events belong to the user acting on the organization.
		const organizationReport = (
			data: Record<string, unknown>,
			ctx: EndpointContext | undefined,
			extra: Record<string, unknown> = {},
		): Report => {
			const org = orgOf(data);
			if (!org?.id) return undefined;
			return {
				userId: stringField(data.user, "id") ?? sessionUserIdOf(ctx),
				properties: { organizationId: org.id, ...extra },
			};
		};

		on("afterCreateOrganization", "organizationCreated", (data, ctx) => {
			const org = orgOf(data);
			return organizationReport(data, ctx, {
				...(org?.slug && { slug: org.slug }),
				...(org?.name && { name: org.name }),
			});
		});
		on("afterUpdateOrganization", "organizationUpdated", organizationReport);
		on("afterDeleteOrganization", "organizationDeleted", organizationReport);

		// Member events belong to the member.
		const memberReport = (
			data: Record<string, unknown>,
			ctx: EndpointContext | undefined,
			extra: Record<string, unknown> = {},
		): Report => {
			const member = data.member as Member | undefined;
			const org = orgOf(data);
			if (!member?.userId || !org?.id) return undefined;
			return {
				userId: member.userId,
				properties: {
					organizationId: org.id,
					memberId: member.id,
					role: member.role,
					...actorOf(ctx, member.userId),
					...extra,
				},
			};
		};

		on("afterAddMember", "organizationMemberAdded", (data, ctx) =>
			// The creator joins as a member while creating the organization.
			ctx?.path === "/organization/create"
				? undefined
				: memberReport(data, ctx),
		);
		on("afterRemoveMember", "organizationMemberRemoved", (data, ctx) =>
			// Leaving is reported by the after hook on /organization/leave.
			ctx?.path === "/organization/leave"
				? undefined
				: memberReport(data, ctx, { reason: "removed" }),
		);
		on("afterUpdateMemberRole", "organizationMemberRoleUpdated", (data, ctx) =>
			memberReport(
				data,
				ctx,
				typeof data.previousRole === "string"
					? { previousRole: data.previousRole }
					: {},
			),
		);

		// Invitation events belong to whoever acts on the invitation, named by
		// `actorField` in the hook's data.
		const invitationReport = (
			data: Record<string, unknown>,
			ctx: EndpointContext | undefined,
			actorField: string,
			extra: Record<string, unknown> = {},
		): Report => {
			const invitationId = stringField(data.invitation, "id");
			const org = orgOf(data);
			if (!invitationId || !org?.id) return undefined;
			return {
				userId: stringField(data[actorField], "id") ?? sessionUserIdOf(ctx),
				properties: { organizationId: org.id, invitationId, ...extra },
			};
		};

		on("afterCreateInvitation", "organizationInvitationSent", (data, ctx) => {
			const role = stringField(data.invitation, "role");
			return invitationReport(data, ctx, "inviter", role ? { role } : {});
		});
		on(
			"afterAcceptInvitation",
			"organizationInvitationAccepted",
			(data, ctx) => {
				const member = data.member as Member | undefined;
				if (!member?.id) return undefined;
				return invitationReport(data, ctx, "user", {
					memberId: member.id,
					role: member.role,
				});
			},
		);
		on("afterRejectInvitation", "organizationInvitationRejected", (data, ctx) =>
			invitationReport(data, ctx, "user"),
		);
		on("afterCancelInvitation", "organizationInvitationCanceled", (data, ctx) =>
			invitationReport(data, ctx, "cancelledBy"),
		);

		// Team events belong to the team member they are about, or else to the
		// user acting on the team.
		const teamReport =
			(memberField?: string): Reader =>
			(data, ctx) => {
				// The default team is part of creating the organization.
				if (ctx?.path === "/organization/create") return undefined;
				const teamId = stringField(data.team, "id");
				const organizationId =
					orgOf(data)?.id ?? stringField(data.team, "organizationId");
				const subject = memberField
					? stringField(data[memberField], "userId")
					: undefined;
				const userId =
					subject ?? stringField(data.user, "id") ?? sessionUserIdOf(ctx);
				if (!teamId || !organizationId || !userId) return undefined;
				return {
					userId,
					properties: {
						organizationId,
						teamId,
						...(memberField ? actorOf(ctx, userId) : {}),
					},
				};
			};

		on("afterCreateTeam", "organizationTeamCreated", teamReport());
		on("afterDeleteTeam", "organizationTeamDeleted", teamReport());
		on(
			"afterAddTeamMember",
			"organizationTeamMemberAdded",
			teamReport("teamMember"),
		);
		on(
			"afterRemoveTeamMember",
			"organizationTeamMemberRemoved",
			teamReport("teamMember"),
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
				const adapter = currentAuthContext()?.internalAdapter;
				emit(key, currentEndpointContext(), async () => {
					// A subscription belongs to a user or to an organization.
					const referenceId = row.referenceId as string;
					const user = await adapter?.findUserById?.(referenceId);
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
			emit("passwordReset", currentEndpointContext(), {
				userId: user.id,
				properties: {},
			});
		});
	}

	function activate(ctx: AuthContextLike): Set<AuthEventKey> {
		const plugins = ctx.options.plugins ?? [];
		const installed = new Set(plugins.map((plugin) => plugin.id));
		const organization = plugins.find((plugin) => plugin.id === "organization");
		const teams = field(organization?.options?.teams, "enabled") === true;
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
									account: AccountRow,
									ctx?: EndpointContext | null,
								) => onAccountCreated(account, ctx ?? undefined),
							},
							delete: {
								after: async (
									account: AccountRow,
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

/** Who deleted a user, judged by the endpoint that did it. */
function deletedByOf(path: string | undefined): "self" | "admin" | "server" {
	if (path === "/admin/remove-user") return "admin";
	if (path?.startsWith("/delete-user")) return "self";
	return "server";
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
