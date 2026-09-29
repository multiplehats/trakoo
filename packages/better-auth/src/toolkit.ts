import type { BackgroundOptions } from "./background.js";
import type { AuthEventKey } from "./events.js";
import type { AuthUser, EndpointContext } from "./request.js";

/** One occurrence of an event, before the plugin's options apply. */
export interface Emission {
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

/** What the plugin's hooks share within one request. */
export interface RequestState {
	createdUsers: Set<string>;
	userUpdates: Set<string>[];
	/** The session a sign-out request is ending. */
	signingOut?: { userId: string; sessionId: string };
	linkedAnonymousUserId?: string;
}

export interface PluginLike {
	id: string;
	options?: Record<string, unknown>;
}

export interface AuthContextLike extends BackgroundOptions {
	options: BackgroundOptions & {
		plugins?: PluginLike[];
		emailAndPassword?: Record<string, unknown>;
	};
	internalAdapter?: {
		findUserById?: (id: string) => Promise<unknown>;
	};
}

/** An after hook's view of the call it follows. */
export interface AfterCall {
	ctx: EndpointContext;
	returned: unknown;
	body: Record<string, unknown>;
	/** The signed-in user making the request. */
	sessionUserId: string | undefined;
}

/** What the plugin shares with the modules that report each Better Auth plugin. */
export interface Toolkit {
	/**
	 * Sends `key` in the background. What the event needs from the request
	 * `ctx` is read now; `emission` may be resolved later.
	 */
	emit(
		key: AuthEventKey,
		ctx: EndpointContext | undefined,
		emission: Emission | (() => Promise<Emission | undefined>),
	): void;
	stateOf(ctx: EndpointContext | undefined): RequestState | undefined;
	/** `{ actorUserId }` when the signed-in user is not `subject`. */
	actorOf(
		ctx: EndpointContext | undefined,
		subject?: string,
	): { actorUserId?: string };
	/**
	 * Chains `handler` after the callback at `target[name]`. The callback's own
	 * result and errors pass through unchanged; `handler` never throws.
	 */
	wrap(
		target: Record<string, unknown> | undefined,
		name: string,
		handler: (...args: unknown[]) => void,
	): void;
	/** The auth context of the call in progress, or the one from init. */
	currentAuthContext(): AuthContextLike | undefined;
}

/** How the events of one Better Auth plugin are reported. */
export interface PluginEvents {
	/** What each endpoint reports once it succeeds, by path. */
	after?: Record<string, (call: AfterCall) => void>;
	/** Wraps the plugin's option callbacks. Runs at init. */
	init?(context: AuthContextLike): void;
}

/** The installed Better Auth plugin with this id. */
export function findPlugin(
	context: AuthContextLike,
	id: string,
): PluginLike | undefined {
	return context.options.plugins?.find((plugin) => plugin.id === id);
}
