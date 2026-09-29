import { field, stringField } from "./fields.js";
import { type SignInMethod, signInMethod } from "./methods.js";
import {
	type AuthUser,
	type EndpointContext,
	currentEndpointContext,
	sessionUserIdOf,
} from "./request.js";
import {
	type AfterCall,
	type PluginEvents,
	type Toolkit,
	findPlugin,
} from "./toolkit.js";

/** The account fields the plugin reads. */
export interface AccountRow {
	userId: string;
	providerId: string;
}

type Ctx = EndpointContext | undefined;

/**
 * Core Better Auth events. The two-factor, phone number and anonymous plugins
 * write through the core tables, so their events are reported here too.
 */
export interface CoreEvents extends PluginEvents {
	/** Database hooks. They run after the transaction commits. */
	userCreated(user: AuthUser, ctx: Ctx): void;
	userUpdating(data: Record<string, unknown>, ctx: Ctx): void;
	userUpdated(user: AuthUser, ctx: Ctx): void;
	userDeleted(user: AuthUser, ctx: Ctx): void;
	accountCreated(account: AccountRow, ctx: Ctx): void;
	accountDeleted(account: AccountRow, ctx: Ctx): void;
	/** Reports a completed sign-in, and the anonymous user it linked. */
	signIn(ctx: EndpointContext, method: SignInMethod): void;
}

export function coreEvents({
	emit,
	stateOf,
	actorOf,
	wrap,
}: Toolkit): CoreEvents {
	const sessionsRevoked =
		(scope: "one" | "all" | "others") =>
		({ ctx, sessionUserId }: AfterCall) => {
			if (!sessionUserId) return;
			emit("sessionsRevoked", ctx, {
				userId: sessionUserId,
				properties: { scope },
			});
		};

	return {
		userCreated(user, ctx) {
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
		},

		userUpdating(data, ctx) {
			stateOf(ctx)?.userUpdates.push(new Set(Object.keys(data ?? {})));
		},

		userUpdated(user, ctx) {
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
		},

		userDeleted(user, ctx) {
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
		},

		accountCreated(account, ctx) {
			if (!ctx) return;
			if (stateOf(ctx)?.createdUsers.has(account.userId)) return;
			emit("accountLinked", ctx, {
				userId: account.userId,
				properties: { provider: account.providerId },
			});
		},

		accountDeleted(account, ctx) {
			if (ctx?.path !== "/unlink-account") return;
			emit("accountUnlinked", ctx, {
				userId: account.userId,
				properties: { provider: account.providerId },
			});
		},

		signIn(ctx, method) {
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
		},

		after: {
			"/sign-out": ({ ctx }) => {
				const signingOut = stateOf(ctx)?.signingOut;
				if (!signingOut) return;
				emit("userSignedOut", ctx, {
					userId: signingOut.userId,
					sessionId: signingOut.sessionId,
					properties: {},
				});
			},
			"/revoke-session": sessionsRevoked("one"),
			"/revoke-sessions": sessionsRevoked("all"),
			"/revoke-other-sessions": sessionsRevoked("others"),
			"/change-password": ({ ctx, returned, body, sessionUserId }) => {
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
		},

		init(context) {
			wrap(context.options.emailAndPassword, "onPasswordReset", (data) => {
				const user = (data as { user?: AuthUser } | undefined)?.user;
				if (!user?.id) return;
				emit("passwordReset", currentEndpointContext(), {
					userId: user.id,
					properties: {},
				});
			});

			// Covers `disableDeleteAnonymousUser`, where no deletion reveals the
			// link.
			wrap(
				findPlugin(context, "anonymous")?.options,
				"onLinkAccount",
				(data) => {
					const link = data as {
						anonymousUser?: { user?: { id?: string } };
						ctx?: EndpointContext;
					};
					const anonymousUserId = link.anonymousUser?.user?.id;
					const state = stateOf(link.ctx ?? currentEndpointContext());
					if (state && anonymousUserId) {
						state.linkedAnonymousUserId = anonymousUserId;
					}
				},
			);
		},
	};
}

/** Who deleted a user, judged by the endpoint that did it. */
function deletedByOf(path: string | undefined): "self" | "admin" | "server" {
	if (path === "/admin/remove-user") return "admin";
	if (path?.startsWith("/delete-user")) return "self";
	return "server";
}
