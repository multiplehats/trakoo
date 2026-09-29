import { defineEvents, typed } from "trakoo";

/**
 * Delivery hints read by the EmitKit provider and ignored by the others. The
 * plugin fills them from each event's defaults and the `emitkit` option.
 */
export interface EmitKitHints {
	__emitkit_channel?: string;
	__emitkit_notify?: boolean;
}

/** How the user proved who they are. */
export type AuthMethod =
	| "email"
	| "username"
	| "social"
	| "generic_oauth"
	| "one_tap"
	| "magic_link"
	| "email_otp"
	| "phone_number"
	| "passkey"
	| "sso"
	| "siwe"
	| "email_verification"
	| "two_factor"
	| "unknown";

type Props<T extends object> = T & EmitKitHints & Record<string, unknown>;

interface SignInProperties {
	method: AuthMethod;
	/** Social, generic OAuth or SSO provider id, such as `google`. */
	provider?: string;
}

interface OrganizationProperties {
	organizationId: string;
}

interface MemberProperties extends OrganizationProperties {
	memberId: string;
	role: string;
	actorUserId?: string;
}

interface InvitationProperties extends OrganizationProperties {
	invitationId: string;
}

interface TeamProperties extends OrganizationProperties {
	teamId: string;
}

interface ActorProperties {
	/** The user who made the change, when it was someone else. */
	actorUserId?: string;
}

interface SubscriptionProperties {
	subscriptionId: string;
	plan: string;
	status?: string;
	/** Set when the subscription belongs to an organization. */
	organizationId?: string;
}

/**
 * The auth lifecycle events `trakooAuth` emits. Merge them into your own
 * registry so your server analytics accepts them:
 *
 * ```ts
 * export const appEvents = defineEvents({ ...authEvents, ...myEvents });
 * ```
 */
export const authEvents = defineEvents({
	userSignedUp: {
		name: "user_signed_up",
		category: "user",
		properties: typed<Props<SignInProperties & { emailVerified: boolean }>>(),
	},
	userSignedIn: {
		name: "user_signed_in",
		category: "user",
		properties: typed<Props<SignInProperties & { twoFactor: boolean }>>(),
	},
	userSignedOut: {
		name: "user_signed_out",
		category: "user",
		properties: typed<Props<object>>(),
	},
	sessionsRevoked: {
		name: "sessions_revoked",
		category: "user",
		properties: typed<Props<{ scope: "one" | "all" | "others" }>>(),
	},
	emailVerified: {
		name: "email_verified",
		category: "user",
		properties: typed<Props<object>>(),
	},
	emailChanged: {
		name: "email_changed",
		category: "user",
		properties: typed<Props<{ emailVerified: boolean }>>(),
	},
	userProfileUpdated: {
		name: "user_profile_updated",
		category: "user",
		properties: typed<Props<ActorProperties & { fields: string[] }>>(),
	},
	passwordChanged: {
		name: "password_changed",
		category: "user",
		properties: typed<Props<{ revokedOtherSessions: boolean }>>(),
	},
	passwordReset: {
		name: "password_reset",
		category: "user",
		properties: typed<Props<object>>(),
	},
	accountLinked: {
		name: "account_linked",
		category: "user",
		properties: typed<Props<{ provider: string }>>(),
	},
	accountUnlinked: {
		name: "account_unlinked",
		category: "user",
		properties: typed<Props<{ provider: string }>>(),
	},
	userDeleted: {
		name: "user_deleted",
		category: "user",
		properties:
			typed<Props<ActorProperties & { deletedBy: "self" | "admin" | "server" }>>(),
	},

	organizationCreated: {
		name: "organization_created",
		category: "organization",
		properties: typed<Props<OrganizationProperties & { slug: string; name: string }>>(),
	},
	organizationUpdated: {
		name: "organization_updated",
		category: "organization",
		properties: typed<Props<OrganizationProperties>>(),
	},
	organizationDeleted: {
		name: "organization_deleted",
		category: "organization",
		properties: typed<Props<OrganizationProperties>>(),
	},
	organizationMemberAdded: {
		name: "organization_member_added",
		category: "organization",
		properties: typed<Props<MemberProperties>>(),
	},
	organizationMemberRemoved: {
		name: "organization_member_removed",
		category: "organization",
		properties:
			typed<Props<MemberProperties & { reason: "removed" | "left" }>>(),
	},
	organizationMemberRoleUpdated: {
		name: "organization_member_role_updated",
		category: "organization",
		properties: typed<Props<MemberProperties & { previousRole?: string }>>(),
	},
	organizationInvitationSent: {
		name: "organization_invitation_sent",
		category: "organization",
		properties: typed<Props<InvitationProperties & { role: string }>>(),
	},
	organizationInvitationAccepted: {
		name: "organization_invitation_accepted",
		category: "organization",
		properties:
			typed<Props<InvitationProperties & { memberId: string; role: string }>>(),
	},
	organizationInvitationRejected: {
		name: "organization_invitation_rejected",
		category: "organization",
		properties: typed<Props<InvitationProperties>>(),
	},
	organizationInvitationCanceled: {
		name: "organization_invitation_canceled",
		category: "organization",
		properties: typed<Props<InvitationProperties>>(),
	},
	organizationTeamCreated: {
		name: "organization_team_created",
		category: "organization",
		properties: typed<Props<TeamProperties>>(),
	},
	organizationTeamDeleted: {
		name: "organization_team_deleted",
		category: "organization",
		properties: typed<Props<TeamProperties>>(),
	},
	organizationTeamMemberAdded: {
		name: "organization_team_member_added",
		category: "organization",
		properties: typed<Props<TeamProperties & ActorProperties>>(),
	},
	organizationTeamMemberRemoved: {
		name: "organization_team_member_removed",
		category: "organization",
		properties: typed<Props<TeamProperties & ActorProperties>>(),
	},

	apiKeyCreated: {
		name: "api_key_created",
		category: "api_key",
		properties:
			typed<
				Props<{
					apiKeyId: string;
					name?: string;
					prefix?: string;
					expiresAt?: string;
				}>
			>(),
	},
	apiKeyUpdated: {
		name: "api_key_updated",
		category: "api_key",
		properties: typed<Props<{ apiKeyId: string; enabled?: boolean }>>(),
	},
	apiKeyDeleted: {
		name: "api_key_deleted",
		category: "api_key",
		properties: typed<Props<{ apiKeyId: string }>>(),
	},

	userBanned: {
		name: "user_banned",
		category: "user",
		properties: typed<Props<ActorProperties & { expiresAt?: string }>>(),
	},
	userUnbanned: {
		name: "user_unbanned",
		category: "user",
		properties: typed<Props<ActorProperties>>(),
	},
	userRoleChanged: {
		name: "user_role_changed",
		category: "user",
		properties: typed<Props<ActorProperties & { role: string }>>(),
	},
	userCreatedByAdmin: {
		name: "user_created_by_admin",
		category: "user",
		properties: typed<Props<ActorProperties & { role?: string }>>(),
	},
	impersonationStarted: {
		name: "user_impersonation_started",
		category: "user",
		properties: typed<Props<ActorProperties>>(),
	},
	impersonationStopped: {
		name: "user_impersonation_stopped",
		category: "user",
		properties: typed<Props<ActorProperties>>(),
	},

	twoFactorEnabled: {
		name: "two_factor_enabled",
		category: "user",
		properties: typed<Props<object>>(),
	},
	twoFactorDisabled: {
		name: "two_factor_disabled",
		category: "user",
		properties: typed<Props<object>>(),
	},
	passkeyAdded: {
		name: "passkey_added",
		category: "user",
		properties: typed<Props<{ passkeyId: string; deviceType?: string }>>(),
	},
	passkeyRemoved: {
		name: "passkey_removed",
		category: "user",
		properties: typed<Props<{ passkeyId: string }>>(),
	},
	phoneNumberVerified: {
		name: "phone_number_verified",
		category: "user",
		properties: typed<Props<object>>(),
	},
	anonymousUserCreated: {
		name: "anonymous_user_created",
		category: "user",
		properties: typed<Props<object>>(),
	},
	anonymousUserLinked: {
		name: "anonymous_user_linked",
		category: "user",
		properties: typed<Props<{ anonymousUserId: string }>>(),
	},
	ssoProviderRegistered: {
		name: "sso_provider_registered",
		category: "user",
		properties:
			typed<
				Props<{
					ssoProviderId: string;
					type?: "oidc" | "saml";
					organizationId?: string;
				}>
			>(),
	},
	ssoProviderDeleted: {
		name: "sso_provider_deleted",
		category: "user",
		properties: typed<Props<{ ssoProviderId: string }>>(),
	},

	subscriptionStarted: {
		name: "subscription_started",
		category: "billing",
		properties:
			typed<
				Props<
					SubscriptionProperties & { interval?: string; trial: boolean }
				>
			>(),
	},
	subscriptionUpdated: {
		name: "subscription_updated",
		category: "billing",
		properties: typed<Props<SubscriptionProperties>>(),
	},
	subscriptionCanceled: {
		name: "subscription_canceled",
		category: "billing",
		properties: typed<Props<SubscriptionProperties>>(),
	},
	subscriptionEnded: {
		name: "subscription_ended",
		category: "billing",
		properties: typed<Props<SubscriptionProperties>>(),
	},
});

/** A registry key of {@link authEvents}, such as `userSignedUp`. */
export type AuthEventKey = Exclude<keyof typeof authEvents, symbol>;

/** A wire name of {@link authEvents}, such as `user_signed_up`. */
export type AuthEventName = (typeof authEvents)[AuthEventKey]["name"];

/** The Better Auth plugin id each plugin event needs. */
export type BetterAuthPluginId =
	| "organization"
	| "api-key"
	| "admin"
	| "two-factor"
	| "passkey"
	| "phone-number"
	| "anonymous"
	| "sso"
	| "stripe";

/** Default EmitKit channels. Rename them with `emitkit.channels`. */
export type AuthChannel = "auth" | "orgs" | "api-keys" | "billing";

export interface AuthEventDefaults {
	readonly plugin?: BetterAuthPluginId;
	readonly channel: AuthChannel;
	readonly notify: boolean;
	/** Calls identify with the user's traits before the event. */
	readonly identify?: boolean;
}

const auth = (
	notify = false,
	extra: Partial<AuthEventDefaults> = {},
): AuthEventDefaults => ({ channel: "auth", notify, ...extra });
const org = (notify = false): AuthEventDefaults => ({
	plugin: "organization",
	channel: "orgs",
	notify,
});
const plugin = (
	id: BetterAuthPluginId,
	channel: AuthChannel = "auth",
	notify = false,
): AuthEventDefaults => ({ plugin: id, channel, notify });

/** Which plugin, channel and notify default each event has. */
export const authEventDefaults: Readonly<
	Record<AuthEventKey, AuthEventDefaults>
> = {
	userSignedUp: auth(true, { identify: true }),
	userSignedIn: auth(false, { identify: true }),
	userSignedOut: auth(),
	sessionsRevoked: auth(),
	emailVerified: auth(false, { identify: true }),
	emailChanged: auth(false, { identify: true }),
	userProfileUpdated: auth(false, { identify: true }),
	passwordChanged: auth(),
	passwordReset: auth(),
	accountLinked: auth(),
	accountUnlinked: auth(),
	userDeleted: auth(),

	organizationCreated: org(true),
	organizationUpdated: org(),
	organizationDeleted: org(),
	organizationMemberAdded: org(),
	organizationMemberRemoved: org(),
	organizationMemberRoleUpdated: org(),
	organizationInvitationSent: org(),
	organizationInvitationAccepted: org(true),
	organizationInvitationRejected: org(),
	organizationInvitationCanceled: org(),
	organizationTeamCreated: org(),
	organizationTeamDeleted: org(),
	organizationTeamMemberAdded: org(),
	organizationTeamMemberRemoved: org(),

	apiKeyCreated: plugin("api-key", "api-keys"),
	apiKeyUpdated: plugin("api-key", "api-keys"),
	apiKeyDeleted: plugin("api-key", "api-keys"),

	userBanned: plugin("admin"),
	userUnbanned: plugin("admin"),
	userRoleChanged: plugin("admin"),
	userCreatedByAdmin: { ...plugin("admin"), identify: true },
	impersonationStarted: plugin("admin"),
	impersonationStopped: plugin("admin"),

	twoFactorEnabled: plugin("two-factor"),
	twoFactorDisabled: plugin("two-factor"),
	passkeyAdded: plugin("passkey"),
	passkeyRemoved: plugin("passkey"),
	phoneNumberVerified: plugin("phone-number"),
	anonymousUserCreated: plugin("anonymous"),
	anonymousUserLinked: plugin("anonymous"),
	ssoProviderRegistered: plugin("sso"),
	ssoProviderDeleted: plugin("sso"),

	subscriptionStarted: plugin("stripe", "billing", true),
	subscriptionUpdated: plugin("stripe", "billing"),
	subscriptionCanceled: plugin("stripe", "billing"),
	subscriptionEnded: plugin("stripe", "billing"),
};

export const authEventKeys = Object.keys(authEventDefaults) as AuthEventKey[];
