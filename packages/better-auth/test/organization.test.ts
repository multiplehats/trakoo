import { organization } from "better-auth/plugins";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, expectNoSecrets, type Harness } from "./helpers.js";

let harness: Harness | undefined;
afterEach(() => {
	if (harness) expectNoSecrets(harness);
	harness = undefined;
});

const orgTables = [
	"organization",
	"member",
	"invitation",
	"team",
	"teamMember",
];

async function setup(
	options: Parameters<typeof organization>[0] = {},
): Promise<Harness> {
	return createHarness({
		plugins: [organization(options)],
		tables: orgTables,
	});
}

describe("organization plugin", () => {
	it("registers the organization events when the plugin is installed", async () => {
		harness = await setup();
		expect(harness.plugin.activeEvents.has("organizationCreated")).toBe(true);
		expect(harness.plugin.activeEvents.has("apiKeyCreated")).toBe(false);
	});

	it("reports a created organization with its name and notifies", async () => {
		harness = await setup();
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		const org = await harness.api.createOrganization({
			headers,
			body: { name: "Analytical Engines", slug: "engines" },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual(["organization_created"]);
		expect(harness.provider.find("organization_created")).toMatchObject({
			userId,
			category: "organization",
			properties: {
				organizationId: org.id,
				slug: "engines",
				name: "Analytical Engines",
				__emitkit_channel: "orgs",
				__emitkit_notify: true,
			},
		});
	});

	it("keeps the app's own organization hooks running", async () => {
		const seen: string[] = [];
		harness = await setup({
			organizationHooks: {
				afterCreateOrganization: async ({ organization }) => {
					seen.push(organization.slug);
				},
			},
		});
		const { headers } = await harness.signUp();
		await harness.api.createOrganization({
			headers,
			body: { name: "Engines", slug: "engines" },
		});
		await harness.flush();

		expect(seen).toEqual(["engines"]);
		expect(harness.provider.names()).toContain("organization_created");
	});

	it("reports updates, invitations, role changes, removals and deletion", async () => {
		let invitationEmailSent = false;
		harness = await setup({
			sendInvitationEmail: async () => {
				invitationEmailSent = true;
			},
		});
		const owner = await harness.signUp("ada@example.com", "Ada");
		const invitee = await harness.signUp("charles@example.com", "Charles");
		const org = await harness.api.createOrganization({
			headers: owner.headers,
			body: { name: "Engines", slug: "engines" },
		});
		await harness.flush();
		harness.provider.clear();

		await harness.api.updateOrganization({
			headers: owner.headers,
			body: { organizationId: org.id, data: { name: "Difference Engines" } },
		});
		const invitation = await harness.api.createInvitation({
			headers: owner.headers,
			body: {
				organizationId: org.id,
				email: "charles@example.com",
				role: "member",
			},
		});
		const accepted = await harness.api.acceptInvitation({
			headers: invitee.headers,
			body: { invitationId: invitation.id },
		});
		await harness.api.updateMemberRole({
			headers: owner.headers,
			body: {
				organizationId: org.id,
				memberId: accepted.member.id,
				role: "admin",
			},
		});
		await harness.api.removeMember({
			headers: owner.headers,
			body: { organizationId: org.id, memberIdOrEmail: accepted.member.id },
		});
		await harness.api.deleteOrganization({
			headers: owner.headers,
			body: { organizationId: org.id },
		});
		await harness.flush();

		expect(invitationEmailSent).toBe(true);
		expect(harness.provider.names()).toEqual([
			"organization_updated",
			"organization_invitation_sent",
			"organization_invitation_accepted",
			"organization_member_role_updated",
			"organization_member_removed",
			"organization_deleted",
		]);
		expect(harness.provider.find("organization_invitation_sent")).toMatchObject(
			{
				userId: owner.userId,
				properties: {
					organizationId: org.id,
					invitationId: invitation.id,
					role: "member",
				},
			},
		);
		expect(
			harness.provider.find("organization_invitation_accepted"),
		).toMatchObject({
			userId: invitee.userId,
			properties: {
				organizationId: org.id,
				invitationId: invitation.id,
				memberId: accepted.member.id,
				role: "member",
				__emitkit_notify: true,
			},
		});
		expect(
			harness.provider.find("organization_member_role_updated"),
		).toMatchObject({
			userId: invitee.userId,
			properties: {
				role: "admin",
				previousRole: "member",
				actorUserId: owner.userId,
			},
		});
		expect(harness.provider.find("organization_member_removed")).toMatchObject({
			userId: invitee.userId,
			properties: { reason: "removed", actorUserId: owner.userId },
		});
		// The invitee's email never leaves the app.
		expect(JSON.stringify(harness.provider.tracked)).not.toContain(
			"charles@example.com",
		);
	});

	it("reports rejected and canceled invitations", async () => {
		harness = await setup({ sendInvitationEmail: async () => {} });
		const owner = await harness.signUp("ada@example.com", "Ada");
		const invitee = await harness.signUp("charles@example.com", "Charles");
		const org = await harness.api.createOrganization({
			headers: owner.headers,
			body: { name: "Engines", slug: "engines" },
		});
		const first = await harness.api.createInvitation({
			headers: owner.headers,
			body: {
				organizationId: org.id,
				email: "charles@example.com",
				role: "member",
			},
		});
		await harness.flush();
		harness.provider.clear();

		await harness.api.rejectInvitation({
			headers: invitee.headers,
			body: { invitationId: first.id },
		});
		const second = await harness.api.createInvitation({
			headers: owner.headers,
			body: {
				organizationId: org.id,
				email: "charles@example.com",
				role: "member",
			},
		});
		await harness.api.cancelInvitation({
			headers: owner.headers,
			body: { invitationId: second.id },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual([
			"organization_invitation_rejected",
			"organization_invitation_sent",
			"organization_invitation_canceled",
		]);
		expect(
			harness.provider.find("organization_invitation_rejected"),
		).toMatchObject({
			userId: invitee.userId,
			properties: { organizationId: org.id, invitationId: first.id },
		});
		expect(
			harness.provider.find("organization_invitation_canceled"),
		).toMatchObject({
			userId: owner.userId,
			properties: { organizationId: org.id, invitationId: second.id },
		});
	});

	it("reports a member added on the server and one who leaves", async () => {
		harness = await setup();
		const owner = await harness.signUp("ada@example.com", "Ada");
		const member = await harness.signUp("charles@example.com", "Charles");
		const org = await harness.api.createOrganization({
			headers: owner.headers,
			body: { name: "Engines", slug: "engines" },
		});
		await harness.flush();
		// Creating the organization adds its owner without a member event.
		expect(harness.provider.names()).not.toContain("organization_member_added");
		harness.provider.clear();

		const added = await harness.api.addMember({
			body: { organizationId: org.id, userId: member.userId, role: "member" },
		});
		await harness.api.leaveOrganization({
			headers: member.headers,
			body: { organizationId: org.id },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual([
			"organization_member_added",
			"organization_member_removed",
		]);
		expect(harness.provider.find("organization_member_added")).toMatchObject({
			userId: member.userId,
			properties: {
				organizationId: org.id,
				memberId: added.id,
				role: "member",
			},
		});
		expect(harness.provider.find("organization_member_removed")).toMatchObject({
			userId: member.userId,
			properties: { reason: "left" },
		});
	});

	it("reports team changes but not the default team", async () => {
		harness = await setup({ teams: { enabled: true } });
		const owner = await harness.signUp("ada@example.com", "Ada");
		await harness.flush();
		harness.provider.clear();
		const org = await harness.api.createOrganization({
			headers: owner.headers,
			body: { name: "Engines", slug: "engines" },
		});
		await harness.flush();
		expect(harness.provider.names()).toEqual(["organization_created"]);
		harness.provider.clear();

		const team = await harness.api.createTeam({
			headers: owner.headers,
			body: { name: "Mill", organizationId: org.id },
		});
		await harness.api.addTeamMember({
			headers: owner.headers,
			body: { teamId: team.id, userId: owner.userId },
		});
		await harness.api.removeTeamMember({
			headers: owner.headers,
			body: { teamId: team.id, userId: owner.userId },
		});
		await harness.api.removeTeam({
			headers: owner.headers,
			body: { teamId: team.id, organizationId: org.id },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual([
			"organization_team_created",
			"organization_team_member_added",
			"organization_team_member_removed",
			"organization_team_deleted",
		]);
		for (const call of harness.provider.tracked) {
			expect(call).toMatchObject({
				userId: owner.userId,
				properties: { organizationId: org.id, teamId: team.id },
			});
		}
	});
});
