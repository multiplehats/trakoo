import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
	getEventDefinition,
	type EventDefinitions,
	type EventName,
	type EventOutputMap,
	type EventRegistry,
} from "./registry.js";
import {
	isNoPropertiesMarker,
	isStandardSchema,
	isTypeMarker,
} from "./schema.js";
import type { EventCategory } from "./types.js";

export type AnalyticsValidationErrorCode =
	| "unknown_event"
	| "invalid_properties"
	| "validator_failure"
	| "invalid_output";

export interface NormalizedValidationIssue {
	readonly message: string;
	readonly path: readonly string[];
}

export interface ValidationConfig {
	readonly onFailure?: "drop" | "throw";
	readonly onError?: (error: AnalyticsValidationError) => void;
}

export class AnalyticsValidationError extends Error {
	readonly name = "AnalyticsValidationError";
	constructor(
		readonly code: AnalyticsValidationErrorCode,
		readonly eventName: string,
		readonly issues: readonly NormalizedValidationIssue[] = [],
	) {
		super(`Analytics event ${eventName} failed: ${code}`);
	}
}

export interface ResolvedEvent<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
> {
	readonly name: N;
	readonly category: EventCategory;
	readonly properties: EventOutputMap<R>[N];
}

function isPropertyObject(value: unknown): value is object {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePathSegment(
	segment: PropertyKey | StandardSchemaV1.PathSegment,
): string {
	let key: unknown = segment;
	try {
		if (typeof segment === "object" && segment !== null && "key" in segment) {
			key = segment.key;
		}
		return String(key);
	} catch {
		return "[unknown]";
	}
}

function normalizeIssues(
	issues: readonly StandardSchemaV1.Issue[],
): readonly NormalizedValidationIssue[] {
	return issues.map((issue) => {
		let message = "Validation failed";
		let path: readonly string[] = [];
		try {
			message = String(issue.message);
		} catch {
			// Keep the fallback message so hostile issue accessors cannot escape validation.
		}
		try {
			path = issue.path?.map(normalizePathSegment) ?? [];
		} catch {
			path = ["[unknown]"];
		}
		return { message, path };
	});
}

/** @internal Shared adapter failure-policy entry point; not part of the public API. */
export async function applyValidationFailurePolicy(
	error: AnalyticsValidationError,
	validation: ValidationConfig | undefined,
	debug: boolean,
): Promise<undefined> {
	if (validation?.onError) {
		try {
			await validation.onError(error);
		} catch {
			// Error reporting must not change the configured tracking policy.
		}
	} else if (debug) {
		try {
			console.warn({
				code: error.code,
				eventName: error.eventName,
				paths: error.issues.map((issue) => issue.path),
			});
		} catch {
			// Debug logging must not change the configured tracking policy.
		}
	}

	if (validation?.onFailure === "throw") {
		throw error;
	}
	return undefined;
}

export async function resolveEvent<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
>(
	registry: R,
	eventName: N,
	input: unknown,
	inputProvided: boolean,
	validation: ValidationConfig | undefined,
	debug: boolean,
): Promise<ResolvedEvent<R, N> | undefined> {
	const definition = getEventDefinition(registry, eventName);
	if (!definition) {
		return applyValidationFailurePolicy(
			new AnalyticsValidationError("unknown_event", eventName),
			validation,
			debug,
		);
	}

	if (isNoPropertiesMarker(definition.properties)) {
		if (inputProvided) {
			return applyValidationFailurePolicy(
				new AnalyticsValidationError("invalid_properties", eventName),
				validation,
				debug,
			);
		}
		return {
			name: eventName,
			category: definition.category,
			properties: {} as EventOutputMap<R>[N],
		};
	}

	if (isTypeMarker(definition.properties)) {
		if (!isPropertyObject(input)) {
			return applyValidationFailurePolicy(
				new AnalyticsValidationError("invalid_properties", eventName),
				validation,
				debug,
			);
		}
		return {
			name: eventName,
			category: definition.category,
			properties: input as EventOutputMap<R>[N],
		};
	}

	if (!isStandardSchema(definition.properties)) {
		return applyValidationFailurePolicy(
			new AnalyticsValidationError("invalid_properties", eventName),
			validation,
			debug,
		);
	}

	let result: StandardSchemaV1.Result<object>;
	try {
		result = await definition.properties["~standard"].validate(input);
	} catch {
		return applyValidationFailurePolicy(
			new AnalyticsValidationError("validator_failure", eventName),
			validation,
			debug,
		);
	}

	try {
		if ("issues" in result && result.issues) {
			return applyValidationFailurePolicy(
				new AnalyticsValidationError(
					"invalid_properties",
					eventName,
					normalizeIssues(result.issues),
				),
				validation,
				debug,
			);
		}

		if (!("value" in result) || !isPropertyObject(result.value)) {
			return applyValidationFailurePolicy(
				new AnalyticsValidationError("invalid_output", eventName),
				validation,
				debug,
			);
		}

		return {
			name: eventName,
			category: definition.category,
			properties: result.value as EventOutputMap<R>[N],
		};
	} catch {
		return applyValidationFailurePolicy(
			new AnalyticsValidationError("validator_failure", eventName),
			validation,
			debug,
		);
	}
}
