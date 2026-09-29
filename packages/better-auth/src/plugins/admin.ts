import { field, isoDate, stringField } from "../fields.js";
import type { AuthUser } from "../request.js";
import type { AfterCall, PluginEvents, Toolkit } from "../toolkit.js";

/** The user an admin endpoint acted on. */
function subjectOf({ returned, body }: AfterCall) {
	const user = field(returned, "user") as AuthUser | undefined;
	return {
		user,
		userId: stringField(user, "id") ?? stringField(body, "userId"),
	};
}

/** Events of the `admin` plugin. They belong to the user acted on. */
export function adminEvents({ emit, actorOf }: Toolkit): PluginEvents {
	return {
		after: {
			"/admin/ban-user": (call) => {
				const { user, userId } = subjectOf(call);
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
			"/admin/unban-user": (call) => {
				const { userId } = subjectOf(call);
				if (!userId) return;
				emit("userUnbanned", call.ctx, {
					userId,
					properties: actorOf(call.ctx, userId),
				});
			},
			"/admin/set-role": (call) => {
				const { user, userId } = subjectOf(call);
				const role = stringField(user, "role") ?? roleString(call.body.role);
				if (!userId || !role) return;
				emit("userRoleChanged", call.ctx, {
					userId,
					properties: { ...actorOf(call.ctx, userId), role },
				});
			},
			"/admin/create-user": (call) => {
				const { user, userId } = subjectOf(call);
				if (!userId) return;
				const role = stringField(user, "role");
				emit("userCreatedByAdmin", call.ctx, {
					userId,
					properties: { ...actorOf(call.ctx, userId), ...(role && { role }) },
					user,
				});
			},
			"/admin/impersonate-user": (call) => {
				const { userId } = subjectOf(call);
				if (!userId) return;
				emit("userImpersonationStarted", call.ctx, {
					userId,
					properties: actorOf(call.ctx, userId),
				});
			},
			"/admin/stop-impersonating": ({ ctx }) => {
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
		},
	};
}

function roleString(role: unknown): string | undefined {
	if (typeof role === "string") return role;
	if (Array.isArray(role) && role.every((entry) => typeof entry === "string")) {
		return role.join(",");
	}
	return undefined;
}
