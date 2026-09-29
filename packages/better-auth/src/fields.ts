/**
 * Readers for values Better Auth hands over untyped: endpoint results, request
 * bodies and plugin callback arguments.
 */

/** `value` as a record, or an empty one when it is not an object. */
export function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

/** A field of an unknown object, of any type. */
export function field(value: unknown, key: string): unknown {
	return record(value)[key];
}

/** A non-empty string field of an unknown object. */
export function stringField(value: unknown, key: string): string | undefined {
	const entry = field(value, key);
	return typeof entry === "string" && entry ? entry : undefined;
}

/** A date, or a date string, as an ISO string. */
export function isoDate(value: unknown): string | undefined {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value.toISOString();
	}
	if (typeof value === "string" && value) return value;
	return undefined;
}
