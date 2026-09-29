import { field, isoDate, stringField } from "../fields.js";
import type { AfterCall, PluginEvents, Toolkit } from "../toolkit.js";

/**
 * The user an API key call acts for: the signed-in user, or the `userId` a
 * server call passes. The key's `referenceId` is not it: an organization's key
 * references the organization.
 */
function userOf({ body, sessionUserId }: AfterCall): string | undefined {
	return sessionUserId ?? stringField(body, "userId");
}

/** Events of the `api-key` plugin. */
export function apiKeyEvents({ emit }: Toolkit): PluginEvents {
	return {
		after: {
			"/api-key/create": (call) => {
				const { ctx, returned, body } = call;
				const apiKeyId = stringField(returned, "id");
				const userId = userOf(call);
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
			"/api-key/update": (call) => {
				const apiKeyId = stringField(call.returned, "id");
				const userId = userOf(call);
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
			"/api-key/delete": (call) => {
				const apiKeyId = stringField(call.body, "keyId");
				const userId = userOf(call);
				if (!apiKeyId || !userId) return;
				emit("apiKeyDeleted", call.ctx, { userId, properties: { apiKeyId } });
			},
		},
	};
}
