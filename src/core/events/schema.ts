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

export type EventPropertiesClassification =
	| { readonly kind: "type" }
	| { readonly kind: "none" }
	| {
			readonly kind: "schema";
			readonly standard: StandardSchemaV1.Props<object, object>;
			readonly validate: StandardSchemaV1.Props<object, object>["validate"];
	  }
	| { readonly kind: "invalid" }
	| { readonly kind: "access_failure" };

/** @internal Classifies external definitions and captures schema accessors safely. */
export function classifyEventProperties(
	value: unknown,
): EventPropertiesClassification {
	if (typeof value !== "object" || value === null) {
		return { kind: "invalid" };
	}

	try {
		if ("kind" in value) {
			if (value.kind === "type") return { kind: "type" };
			if (value.kind === "none") return { kind: "none" };
		}

		if (!("~standard" in value)) return { kind: "invalid" };
		const standard = value["~standard"];
		if (
			typeof standard !== "object" ||
			standard === null ||
			!("validate" in standard)
		) {
			return { kind: "invalid" };
		}

		const validate = standard.validate as StandardSchemaV1.Props<
			object,
			object
		>["validate"];
		if (typeof validate !== "function") return { kind: "invalid" };
		return {
			kind: "schema",
			standard: standard as StandardSchemaV1.Props<object, object>,
			validate,
		};
	} catch {
		return { kind: "access_failure" };
	}
}

export function isTypeMarker(value: unknown): value is TypeMarker<object> {
	return classifyEventProperties(value).kind === "type";
}

export function isNoPropertiesMarker(
	value: unknown,
): value is NoPropertiesMarker {
	return classifyEventProperties(value).kind === "none";
}

export function isStandardSchema(
	value: unknown,
): value is StandardSchemaV1<object, object> {
	return classifyEventProperties(value).kind === "schema";
}
