import type { AuthEventKey } from "../events.js";
import { record, stringField } from "../fields.js";
import {
	type EndpointContext,
	currentEndpointContext,
	sessionUserIdOf,
} from "../request.js";
import {
	type Emission,
	type PluginEvents,
	type Toolkit,
	findPlugin,
} from "../toolkit.js";

type Org = { id: string; slug?: string; name?: string };
type Member = { id: string; userId: string; role: string };
type Ctx = EndpointContext | undefined;
type Data = Record<string, unknown>;
/** An event's user and properties, or nothing to report. */
type Report = Pick<Emission, "userId" | "properties"> | undefined;

const orgOf = (data: Data) => data.organization as Org | undefined;

/** Organization events belong to the user acting on the organization. */
function organizationReport(
	data: Data,
	ctx: Ctx,
	extra: Record<string, unknown> = {},
): Report {
	const org = orgOf(data);
	if (!org?.id) return undefined;
	return {
		userId: stringField(data.user, "id") ?? sessionUserIdOf(ctx),
		properties: { organizationId: org.id, ...extra },
	};
}

/**
 * Invitation events belong to whoever acts on the invitation, named by
 * `actorField` in the hook's data.
 */
function invitationReport(
	data: Data,
	ctx: Ctx,
	actorField: string,
	extra: Record<string, unknown> = {},
): Report {
	const invitationId = stringField(data.invitation, "id");
	const org = orgOf(data);
	if (!invitationId || !org?.id) return undefined;
	return {
		userId: stringField(data[actorField], "id") ?? sessionUserIdOf(ctx),
		properties: { organizationId: org.id, invitationId, ...extra },
	};
}

/**
 * Events of the `organization` plugin, from its `organizationHooks` and the
 * endpoint a member leaves through.
 */
export function organizationEvents({
	emit,
	actorOf,
	wrap,
}: Toolkit): PluginEvents {
	/** Member events belong to the member. */
	const memberReport = (
		data: Data,
		ctx: Ctx,
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

	/**
	 * Team events belong to the team member they are about, or else to the
	 * user acting on the team.
	 */
	const teamReport =
		(memberField?: string) =>
		(data: Data, ctx: Ctx): Report => {
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

	return {
		after: {
			"/organization/leave": ({ ctx, returned, sessionUserId }) => {
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
		},

		init(context) {
			const pluginOptions = findPlugin(context, "organization")?.options;
			if (!pluginOptions) return;
			pluginOptions.organizationHooks ??= {};
			const hooks = pluginOptions.organizationHooks as Record<string, unknown>;

			/** Reports `key` after the hook `name`, when `read` finds an event. */
			const on = (
				name: string,
				key: AuthEventKey,
				read: (data: Data, ctx: Ctx) => Report,
			) =>
				wrap(hooks, name, (data) => {
					const ctx = currentEndpointContext();
					const report = read(record(data), ctx);
					if (report?.userId) emit(key, ctx, report);
				});

			on("afterCreateOrganization", "organizationCreated", (data, ctx) => {
				const org = orgOf(data);
				return organizationReport(data, ctx, {
					...(org?.slug && { slug: org.slug }),
					...(org?.name && { name: org.name }),
				});
			});
			on("afterUpdateOrganization", "organizationUpdated", organizationReport);
			on("afterDeleteOrganization", "organizationDeleted", organizationReport);

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
			on(
				"afterUpdateMemberRole",
				"organizationMemberRoleUpdated",
				(data, ctx) =>
					memberReport(
						data,
						ctx,
						typeof data.previousRole === "string"
							? { previousRole: data.previousRole }
							: {},
					),
			);

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
			on(
				"afterRejectInvitation",
				"organizationInvitationRejected",
				(data, ctx) => invitationReport(data, ctx, "user"),
			);
			on(
				"afterCancelInvitation",
				"organizationInvitationCanceled",
				(data, ctx) => invitationReport(data, ctx, "cancelledBy"),
			);

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
		},
	};
}
