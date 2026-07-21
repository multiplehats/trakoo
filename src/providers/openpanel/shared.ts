import type { BaseEvent, EventContext } from "@/core/events/types.js";
import type { IdentifyPayload } from "@openpanel/sdk";

const PROFILE_FIELDS = ["firstName", "lastName", "email", "avatar"] as const;

export function buildIdentifyPayload(
	userId: string,
	traits?: Record<string, unknown>,
): IdentifyPayload {
	const payload: IdentifyPayload = { profileId: userId };
	const properties: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(traits ?? {})) {
		if (
			PROFILE_FIELDS.includes(key as (typeof PROFILE_FIELDS)[number]) &&
			typeof value === "string"
		) {
			if (key === "firstName") payload.firstName = value;
			if (key === "lastName") payload.lastName = value;
			if (key === "email") payload.email = value;
			if (key === "avatar") payload.avatar = value;
		} else {
			properties[key] = value;
		}
	}

	if (Object.keys(properties).length > 0) {
		payload.properties = properties;
	}

	return payload;
}

export function buildEventProperties(
	properties: Record<string, unknown> | undefined,
	context: EventContext | undefined,
	metadata: {
		category?: string;
		timestamp?: number;
		userId?: string;
		sessionId?: string;
	},
): Record<string, unknown> {
	const pagePath = context?.page?.url ?? context?.page?.path;

	return {
		...properties,
		...(metadata.category && { category: metadata.category }),
		...(metadata.timestamp !== undefined && {
			__timestamp: new Date(metadata.timestamp).toISOString(),
		}),
		...(metadata.userId && { profileId: metadata.userId }),
		...(metadata.sessionId && { sessionId: metadata.sessionId }),
		...(pagePath && { __path: pagePath }),
		...(context?.page?.title && { __title: context.page.title }),
		...(context?.page?.referrer && { __referrer: context.page.referrer }),
		...(context?.page && { page: context.page }),
		...(context?.device && { device: context.device }),
		...(context?.utm && { utm: context.utm }),
		...(context?.user?.email && { user_email: context.user.email }),
		...(context?.user?.traits && { user_traits: context.user.traits }),
	};
}

export function buildTrackedEventProperties(
	event: BaseEvent,
	context?: EventContext,
): Record<string, unknown> {
	return buildEventProperties(event.properties, context, {
		category: event.category,
		timestamp: event.timestamp,
		userId: event.userId ?? context?.user?.userId,
		sessionId: event.sessionId,
	});
}
