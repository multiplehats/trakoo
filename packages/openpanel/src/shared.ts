import type { BaseEvent, EventContext } from "trakoo";
import { type OpenPanelRequestContext, REQUEST_CONTEXT } from "./transport.js";
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

/**
 * Collects the attributes OpenPanel resolves from request headers rather than
 * from the event body: the caller's IP for geo, its user agent for the device.
 * `server` is the request-scoped source a server caller populates; `device` is
 * the fallback for callers that already put the visitor there.
 */
export function buildRequestContext(
	context: EventContext | undefined,
): OpenPanelRequestContext | undefined {
	const ip = firstString(context?.server?.ip, context?.device?.ip);
	const userAgent = firstString(
		context?.server?.userAgent,
		context?.device?.userAgent,
	);
	if (!ip && !userAgent) return undefined;

	return { ...(ip && { ip }), ...(userAgent && { userAgent }) };
}

/**
 * Parks the request attributes on the payload for the delivery transport to
 * move onto this one request's headers, and drops the IP from the `device`
 * property when that is where it was read from: geo belongs to the request,
 * and a raw address stored on every event is a liability the header avoids.
 *
 * Only the server provider applies this. A browser sends its own headers, and
 * `user-agent` is forbidden to `fetch()` there.
 */
export function withRequestContext(
	properties: Record<string, unknown>,
	context: EventContext | undefined,
): Record<string, unknown> {
	const requestContext = buildRequestContext(context);
	if (!requestContext) return properties;

	// Only the address copied out of `context.device` is removed. A `device`
	// the event declared itself is its own data, and an IP promoted from
	// `context.server` says nothing about it.
	if (typeof context?.device?.ip !== "string") {
		return { ...properties, [REQUEST_CONTEXT]: requestContext };
	}

	const { device: _contextDevice, ...rest } = properties;
	const device = withoutIp(properties.device);

	return {
		...rest,
		...(device !== undefined && { device }),
		[REQUEST_CONTEXT]: requestContext,
	};
}

function withoutIp(device: unknown): unknown {
	if (!device || typeof device !== "object") return device;

	const { ip: _promoted, ...rest } = device as Record<string, unknown>;
	return Object.keys(rest).length > 0 ? rest : undefined;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value) return value;
	}
	return undefined;
}
