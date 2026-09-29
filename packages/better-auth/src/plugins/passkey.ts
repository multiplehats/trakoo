import { stringField } from "../fields.js";
import type { PluginEvents, Toolkit } from "../toolkit.js";

/** Events of the `passkey` plugin. */
export function passkeyEvents({ emit }: Toolkit): PluginEvents {
	return {
		after: {
			"/passkey/verify-registration": ({ ctx, returned, sessionUserId }) => {
				const passkeyId = stringField(returned, "id");
				const userId = sessionUserId ?? stringField(returned, "userId");
				if (!passkeyId || !userId) return;
				const deviceType = stringField(returned, "deviceType");
				emit("passkeyAdded", ctx, {
					userId,
					properties: { passkeyId, ...(deviceType && { deviceType }) },
				});
			},
			"/passkey/delete-passkey": ({ ctx, body, sessionUserId }) => {
				const passkeyId = stringField(body, "id");
				if (!passkeyId || !sessionUserId) return;
				emit("passkeyRemoved", ctx, {
					userId: sessionUserId,
					properties: { passkeyId },
				});
			},
		},
	};
}
