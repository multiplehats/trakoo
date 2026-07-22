import type { StandardSchemaV1, StandardTypedV1 } from "@standard-schema/spec";

declare const typeMarkerBrand: unique symbol;
declare const noPropertiesBrand: unique symbol;

export type PropertyObject<T> = T extends readonly unknown[]
	? never
	: T extends (...args: never[]) => unknown
		? never
		: T extends object
			? T
			: never;

type InvalidPropertyArguments<T> = PropertyObject<T> extends never
	? [error: "typed<T>() requires a non-array, non-callable object shape"]
	: [];

export interface TypeMarker<T extends object> extends StandardTypedV1<T, T> {
	readonly kind: "type";
	readonly [typeMarkerBrand]: T;
}

export interface NoPropertiesMarker
	extends StandardTypedV1<undefined, Record<never, never>> {
	readonly kind: "none";
	readonly [noPropertiesBrand]: true;
}

export function typed<T extends object>(
	..._invalid: InvalidPropertyArguments<T>
): TypeMarker<T> {
	return Object.freeze({
		kind: "type",
		"~standard": { version: 1, vendor: "trakoo" },
	}) as TypeMarker<T>;
}

export function noProperties(): NoPropertiesMarker {
	return Object.freeze({
		kind: "none",
		"~standard": { version: 1, vendor: "trakoo" },
	}) as NoPropertiesMarker;
}

export type InferMarker<T> = T extends TypeMarker<infer TValue>
	? TValue
	: Record<string, unknown>;

export type EventProperties =
	| TypeMarker<object>
	| NoPropertiesMarker
	| StandardSchemaV1<object, object>;

export function isTypeMarker(value: unknown): value is TypeMarker<object> {
	return typeof value === "object" && value !== null && "kind" in value && value.kind === "type";
}

export function isNoPropertiesMarker(
	value: unknown,
): value is NoPropertiesMarker {
	return typeof value === "object" && value !== null && "kind" in value && value.kind === "none";
}

export function isStandardSchema(
	value: unknown,
): value is StandardSchemaV1<object, object> {
	if (typeof value !== "object" || value === null || !("~standard" in value)) {
		return false;
	}

	const standard = value["~standard"];
	return (
		typeof standard === "object" &&
		standard !== null &&
		"validate" in standard &&
		typeof standard.validate === "function"
	);
}
