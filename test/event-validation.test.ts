import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
	AnalyticsValidationError,
	defineEvents,
	noProperties,
	resolveEvent,
	typed,
	type EventName,
} from "@/core/events";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

const success = { value: { amount: 49 } };
const failure = { issues: [{ message: "invalid", path: ["amount"] }] };
const asyncSuccess = Promise.resolve({ value: { amount: 49 } });

function schema<TInput extends object, TOutput extends object>(
	validate: StandardSchemaV1.Props<TInput, TOutput>["validate"],
): StandardSchemaV1<TInput, TOutput> {
	return {
		"~standard": {
			version: 1,
			vendor: "trakoo-test",
			validate,
		},
	};
}

function invalidResult<TOutput extends object>(
	value: unknown,
): StandardSchemaV1.Result<TOutput> {
	return { value } as StandardSchemaV1.Result<TOutput>;
}

const events = defineEvents({
	purchaseCompleted: {
		name: "purchase_completed",
		category: "conversion",
		properties: schema<{ amount: string }, { amount: number }>(() => success),
	},
	asyncPurchaseCompleted: {
		name: "async_purchase_completed",
		category: "conversion",
		properties: schema<{ amount: string }, { amount: number }>(
			() => asyncSuccess,
		),
	},
	invalidPurchase: {
		name: "invalid_purchase",
		category: "conversion",
		properties: schema<{ amount: string }, { amount: number }>(() => failure),
	},
	throwingPurchase: {
		name: "throwing_purchase",
		category: "conversion",
		properties: schema<{ amount: string }, { amount: number }>(() => {
			throw new Error("validator retained secret-input");
		}),
	},
	rejectingPurchase: {
		name: "rejecting_purchase",
		category: "conversion",
		properties: schema<{ amount: string }, { amount: number }>(() =>
			Promise.reject(new Error("rejected secret-input")),
		),
	},
	primitiveOutput: {
		name: "primitive_output",
		category: "conversion",
		properties: schema<object, { amount: number }>(() =>
			invalidResult<{ amount: number }>(49),
		),
	},
	nullOutput: {
		name: "null_output",
		category: "conversion",
		properties: schema<object, { amount: number }>(() =>
			invalidResult<{ amount: number }>(null),
		),
	},
	arrayOutput: {
		name: "array_output",
		category: "conversion",
		properties: schema<object, { amount: number }>(() =>
			invalidResult<{ amount: number }>([49]),
		),
	},
	typedEvent: {
		name: "typed_event",
		category: "engagement",
		properties: typed<{ label: string }>(),
	},
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
	},
});

type RuntimeEventName = EventName<typeof events>;

async function rejectedValidationError(
	promise: Promise<unknown>,
): Promise<AnalyticsValidationError> {
	const error = await promise.then(
		() => undefined,
		(reason: unknown) => reason,
	);
	expect(error).toBeInstanceOf(AnalyticsValidationError);
	return error as AnalyticsValidationError;
}

describe("resolveEvent", () => {
	it("returns transformed output from a synchronous Standard Schema validator", async () => {
		const resolved = await resolveEvent(
			events,
			"purchase_completed",
			{ amount: "49" },
			true,
			undefined,
			false,
		);

		expect(resolved).toEqual({
			name: "purchase_completed",
			category: "conversion",
			properties: { amount: 49 },
		});
		expectTypeOf(resolved?.properties).toEqualTypeOf<
			{ amount: number } | undefined
		>();
	});

	it("awaits successful asynchronous validation", async () => {
		await expect(
			resolveEvent(
				events,
				"async_purchase_completed",
				{ amount: "49" },
				true,
				undefined,
				false,
			),
		).resolves.toMatchObject({ properties: { amount: 49 } });
	});

	it("does not resolve until a deferred validator finishes", async () => {
		let finishValidation:
			| ((result: StandardSchemaV1.Result<{ amount: number }>) => void)
			| undefined;
		const deferred = new Promise<StandardSchemaV1.Result<{ amount: number }>>(
			(resolve) => {
				finishValidation = resolve;
			},
		);
		const deferredEvents = defineEvents({
			purchase: {
				name: "deferred_purchase",
				category: "conversion",
				properties: schema<{ amount: string }, { amount: number }>(
					() => deferred,
				),
			},
		});
		let settled = false;
		const resolution = resolveEvent(
			deferredEvents,
			"deferred_purchase",
			{ amount: "49" },
			true,
			undefined,
			false,
		).then((result) => {
			settled = true;
			return result;
		});

		await Promise.resolve();
		expect(settled).toBe(false);
		finishValidation?.(success);
		await expect(resolution).resolves.toMatchObject({
			properties: { amount: 49 },
		});
	});

	it("normalizes returned validation issues", async () => {
		const symbolKey = Symbol("private");
		const issueEvents = defineEvents({
			purchase: {
				name: "path_purchase",
				category: "conversion",
				properties: schema<object, { amount: number }>(() => ({
					issues: [
						{
							message: "invalid",
							path: ["amount", 0, symbolKey, { key: "nested" }],
						},
					],
				})),
			},
		});

		const error = await rejectedValidationError(
			resolveEvent(
				issueEvents,
				"path_purchase",
				{},
				true,
				{ onFailure: "throw" },
				false,
			),
		);

		expect(error).toMatchObject({
			code: "invalid_properties",
			eventName: "path_purchase",
			issues: [
				{
					message: "invalid",
					path: ["amount", "0", "Symbol(private)", "nested"],
				},
			],
		});
	});

	it.each(["throwing_purchase", "rejecting_purchase"] as const)(
		"maps a failed %s validator to validator_failure",
		async (eventName) => {
			const error = await rejectedValidationError(
				resolveEvent(
					events,
					eventName,
					{ amount: "secret-input" },
					true,
					{ onFailure: "throw" },
					false,
				),
			);

			expect(error).toMatchObject({ code: "validator_failure", issues: [] });
		},
	);

	it.each(["primitive_output", "null_output", "array_output"] as const)(
		"rejects non-property-object output from %s",
		async (eventName) => {
			const error = await rejectedValidationError(
				resolveEvent(
					events,
					eventName,
					{},
					true,
					{ onFailure: "throw" },
					false,
				),
			);

			expect(error.code).toBe("invalid_output");
		},
	);

	it("accepts only non-null, non-array objects for type markers", async () => {
		const properties = { label: "Sign up" };
		await expect(
			resolveEvent(events, "typed_event", properties, true, undefined, false),
		).resolves.toMatchObject({ properties });

		for (const input of [undefined, null, "label", [properties]]) {
			const error = await rejectedValidationError(
				resolveEvent(
					events,
					"typed_event",
					input,
					true,
					{ onFailure: "throw" },
					false,
				),
			);
			expect(error.code).toBe("invalid_properties");
		}
	});

	it("normalizes omitted propertyless input to an empty object", async () => {
		await expect(
			resolveEvent(
				events,
				"session_started",
				undefined,
				false,
				undefined,
				false,
			),
		).resolves.toEqual({
			name: "session_started",
			category: "user",
			properties: {},
		});
	});

	it.each([undefined, {}, null])(
		"rejects explicitly supplied propertyless input %#",
		async (input) => {
			const error = await rejectedValidationError(
				resolveEvent(
					events,
					"session_started",
					input,
					true,
					{ onFailure: "throw" },
					false,
				),
			);
			expect(error.code).toBe("invalid_properties");
		},
	);

	it("drops unknown event names by default", async () => {
		await expect(
			resolveEvent(
				events,
				"missing_event" as RuntimeEventName,
				{},
				true,
				undefined,
				false,
			),
		).resolves.toBeUndefined();
	});

	it("throws normalized errors only when explicitly configured", async () => {
		const error = await rejectedValidationError(
			resolveEvent(
				events,
				"invalid_purchase",
				{ amount: "invalid" },
				true,
				{ onFailure: "throw" },
				false,
			),
		);

		expect(error).toMatchObject({
			name: "AnalyticsValidationError",
			code: "invalid_properties",
			eventName: "invalid_purchase",
			issues: [{ message: "invalid", path: ["amount"] }],
		});
		expect(error.message).toBe(
			"Analytics event invalid_purchase failed: invalid_properties",
		);
	});

	it("invokes onError exactly once before applying the drop policy", async () => {
		const onError = vi.fn();

		await expect(
			resolveEvent(
				events,
				"invalid_purchase",
				{ amount: "invalid" },
				true,
				{ onError },
				false,
			),
		).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "invalid_properties" }),
		);
	});

	it("contains throwing and rejected onError callbacks", async () => {
		const throwingCallback = vi.fn(() => {
			throw new Error("callback failure");
		});
		const rejectedCallback = vi.fn(async () => {
			throw new Error("async callback failure");
		});

		await expect(
			resolveEvent(
				events,
				"invalid_purchase",
				{},
				true,
				{ onError: throwingCallback },
				false,
			),
		).resolves.toBeUndefined();
		const error = await rejectedValidationError(
			resolveEvent(
				events,
				"invalid_purchase",
				{},
				true,
				{ onFailure: "throw", onError: rejectedCallback },
				false,
			),
		);

		expect(throwingCallback).toHaveBeenCalledOnce();
		expect(rejectedCallback).toHaveBeenCalledOnce();
		expect(error.code).toBe("invalid_properties");
	});

	it("logs only sanitized metadata when debug fallback is enabled", async () => {
		const debugEvents = defineEvents({
			purchase: {
				name: "debug_purchase",
				category: "conversion",
				properties: schema<object, { amount: number }>(() => ({
					issues: [
						{
							message: "invalid secret-message",
							path: ["amount"],
						},
					],
				})),
			},
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await resolveEvent(
			debugEvents,
			"debug_purchase",
			{ amount: "secret-input" },
			true,
			undefined,
			true,
		);

		expect(warn).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith({
			code: "invalid_properties",
			eventName: "debug_purchase",
			paths: [["amount"]],
		});
		expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
		warn.mockRestore();
	});

	it("never retains input, payload, or validator exceptions on errors", async () => {
		const error = await rejectedValidationError(
			resolveEvent(
				events,
				"throwing_purchase",
				{ amount: "secret-input" },
				true,
				{ onFailure: "throw" },
				false,
			),
		);

		expect("input" in error).toBe(false);
		expect("payload" in error).toBe(false);
		expect("cause" in error).toBe(false);
		expect(JSON.stringify(error)).not.toContain("secret-input");
	});
});
