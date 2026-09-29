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
