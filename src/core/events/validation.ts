import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
	getEventClassification,
	getEventDefinition,
	type EventDefinitions,
	type EventName,
	type EventOutputMap,
	type EventRegistry,
} from "./registry.js";
import {
	classifyEventProperties,
	type EventPropertiesClassification,
} from "./schema.js";
import type { EventCategory } from "./types.js";

export type AnalyticsValidationErrorCode =
	| "unknown_event"
	| "invalid_properties"
	| "invalid_options"
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

interface ClassifiedRegisteredEvent {
	readonly category: EventCategory;
	readonly classification: Exclude<
		EventPropertiesClassification,
		{ kind: "access_failure" }
	>;
}

/**
 * Shared registry lookup + classification plumbing for resolveEvent and
 * resolveReplayEvent. Applies the failure policy (and returns undefined)
 * for unknown events, hostile category/classification access, and
 * access_failure classifications.
 */
async function classifyRegisteredEvent<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
>(
	registry: R,
	eventName: N,
	validation: ValidationConfig | undefined,
	debug: boolean,
): Promise<ClassifiedRegisteredEvent | undefined> {
	const definition = getEventDefinition(registry, eventName);
	if (!definition) {
		return applyValidationFailurePolicy(
			new AnalyticsValidationError("unknown_event", eventName),
			validation,
			debug,
		);
	}

	let category: EventCategory;
	let classification: EventPropertiesClassification;
	try {
		// A hostile getter can throw on the category read — this guard is
		// load-bearing even though classification itself is cached.
		category = definition.category;
		classification =
			getEventClassification(registry, eventName) ??
			classifyEventProperties(definition.properties);
	} catch {
		return applyValidationFailurePolicy(
			new AnalyticsValidationError("validator_failure", eventName),
			validation,
			debug,
		);
	}

	if (classification.kind === "access_failure") {
		return applyValidationFailurePolicy(
			new AnalyticsValidationError("validator_failure", eventName),
			validation,
			debug,
		);
	}

	return { category, classification };
}

function failInvalidProperties(
	eventName: string,
	validation: ValidationConfig | undefined,
	debug: boolean,
): Promise<undefined> {
	return applyValidationFailurePolicy(
		new AnalyticsValidationError("invalid_properties", eventName),
		validation,
		debug,
	);
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
	const classified = await classifyRegisteredEvent(
		registry,
		eventName,
		validation,
		debug,
	);
	if (!classified) return undefined;
	const { category, classification } = classified;

	if (classification.kind === "none") {
		if (inputProvided) {
			return failInvalidProperties(eventName, validation, debug);
		}
		return {
			name: eventName,
			category,
			properties: {} as EventOutputMap<R>[N],
		};
	}

	if (classification.kind === "type") {
		if (!isPropertyObject(input)) {
			return failInvalidProperties(eventName, validation, debug);
		}
		return {
			name: eventName,
			category,
			properties: input as EventOutputMap<R>[N],
		};
	}

	if (classification.kind === "invalid") {
		return failInvalidProperties(eventName, validation, debug);
	}

	let result: StandardSchemaV1.Result<object>;
	try {
		result = await classification.validate.call(classification.standard, input);
	} catch {
		return applyValidationFailurePolicy(
			new AnalyticsValidationError("validator_failure", eventName),
			validation,
			debug,
		);
	}

	let failure: AnalyticsValidationError | undefined;
	let output: object | undefined;
	try {
		if ("issues" in result) {
			const issues = result.issues;
			if (issues) {
				failure = new AnalyticsValidationError(
					"invalid_properties",
					eventName,
					normalizeIssues(issues),
				);
			}
		}

		if (!failure) {
			if (!("value" in result)) {
				failure = new AnalyticsValidationError("invalid_output", eventName);
			} else {
				const value = result.value;
				if (isPropertyObject(value)) {
					output = value;
				} else {
					failure = new AnalyticsValidationError("invalid_output", eventName);
				}
			}
		}
	} catch {
		failure = new AnalyticsValidationError("validator_failure", eventName);
	}

	if (failure) {
		return applyValidationFailurePolicy(failure, validation, debug);
	}

	return {
		name: eventName,
		category,
		properties: output as EventOutputMap<R>[N],
	};
}

/**
 * @internal Resolves a proxy-replayed event without re-running schema
 * validation; not part of the public API.
 *
 * Replayed proxy properties are the client-validated POST-TRANSFORM output of
 * the event's validator. Standard Schema validators only accept input, so
 * re-validating that output on the server would reject any transforming
 * schema (e.g. zod's `z.string().transform(Number)`). Schema-backed events
 * therefore only get a structural property-object check here.
 */
export async function resolveReplayEvent<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
>(
	registry: R,
	eventName: N,
	rawProperties: unknown,
	validation: ValidationConfig | undefined,
	debug: boolean,
): Promise<ResolvedEvent<R, N> | undefined> {
	const classified = await classifyRegisteredEvent(
		registry,
		eventName,
		validation,
		debug,
	);
	if (!classified) return undefined;
	const { category, classification } = classified;

	if (classification.kind === "none") {
		const isEmptyObject =
			isPropertyObject(rawProperties) &&
			Object.keys(rawProperties).length === 0;
		if (rawProperties !== undefined && !isEmptyObject) {
			return failInvalidProperties(eventName, validation, debug);
		}
		return {
			name: eventName,
			category,
			properties: {} as EventOutputMap<R>[N],
		};
	}

	if (classification.kind === "invalid") {
		return failInvalidProperties(eventName, validation, debug);
	}

	// kind "type" or "schema": pass the replayed properties through as-is.
	// For "schema" this deliberately skips the validator — see the note above.
	if (!isPropertyObject(rawProperties)) {
		return failInvalidProperties(eventName, validation, debug);
	}

	return {
		name: eventName,
		category,
		properties: rawProperties as EventOutputMap<R>[N],
	};
}
