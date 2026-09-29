import type { EventContext } from "@/core/events/types.js";

/**
 * User traits that identify a person directly. A provider routed with
 * `pii: false` never receives them, in identify traits or in an event's user
 * context.
 */
export const PII_TRAIT_KEYS: readonly string[] = [
	"email",
	"name",
	"firstName",
	"lastName",
	"phone",
];

export function withoutPiiTraits<T extends Record<string, unknown>>(
	traits: T | undefined,
): T | undefined {
	if (!traits) return traits;
	return Object.fromEntries(
		Object.entries(traits).filter(([key]) => !PII_TRAIT_KEYS.includes(key)),
	) as T;
}

/** The context without the user's email and personal traits. */
export function withoutPiiContext(
	context: EventContext | undefined,
): EventContext | undefined {
	if (!context?.user) return context;
	const { email: _email, traits, ...user } = context.user;
	return {
		...context,
		user: {
			...user,
			...(traits && {
				traits: withoutPiiTraits(traits as Record<string, unknown>),
			}),
		},
	};
}

/** A provider entry's routing, as far as personal data goes. */
interface PiiRouting {
	/** Whether the provider may receive personal data. */
	readonly pii: boolean;
}

/** The identify traits the provider of `routing` may receive. */
export function providerTraits<T extends Record<string, unknown>>(
	routing: PiiRouting,
	traits: T | undefined,
): T | undefined {
	return routing.pii ? traits : withoutPiiTraits(traits);
}

/** The event context the provider of `routing` may receive. */
export function providerContext(
	routing: PiiRouting,
	context: EventContext | undefined,
): EventContext | undefined {
	return routing.pii ? context : withoutPiiContext(context);
}
