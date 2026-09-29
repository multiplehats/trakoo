import { field, stringField } from "../fields.js";
import type { PluginEvents, Toolkit } from "../toolkit.js";

/** Events of the `sso` plugin. */
export function ssoEvents({ emit }: Toolkit): PluginEvents {
	return {
		after: {
			"/sso/register": ({ ctx, returned, body, sessionUserId }) => {
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
			"/sso/delete-provider": ({ ctx, body, sessionUserId }) => {
				const ssoProviderId = stringField(body, "providerId");
				if (!ssoProviderId || !sessionUserId) return;
				emit("ssoProviderDeleted", ctx, {
					userId: sessionUserId,
					properties: { ssoProviderId },
				});
			},
		},
	};
}
