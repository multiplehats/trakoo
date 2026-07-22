import {
	defineEvents,
	getEventDefinition,
	isNoPropertiesMarker,
	isStandardSchema,
	isTypeMarker,
	noProperties,
	typed,
	type ClientTrackArgs,
	type EventInputMap,
	type EventName,
	type EventOutputMap,
	type ServerTrackArgs,
} from "@/core/events";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

interface ClickProperties {
	buttonId: string;
	location?: string;
}

const events = defineEvents({
	buttonClicked: {
		name: "button_clicked",
		category: "engagement",
		properties: typed<ClickProperties>(),
	},
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
	},
	formSubmitted: {
		name: "form_submitted",
		category: "conversion",
		properties: z
			.object({ rawValue: z.string() })
			.transform(({ rawValue }) => ({ normalizedValue: rawValue.trim() })),
	},
});

describe("event schema markers", () => {
	it("preserves event names, property types, and literal categories", () => {
		expectTypeOf<EventName<typeof events>>().toEqualTypeOf<
			"button_clicked" | "session_started" | "form_submitted"
		>();
		expectTypeOf<EventInputMap<typeof events>["button_clicked"]>().toEqualTypeOf<ClickProperties>();
		expectTypeOf<EventOutputMap<typeof events>["button_clicked"]>().toEqualTypeOf<ClickProperties>();
		expectTypeOf<EventInputMap<typeof events>["session_started"]>().toEqualTypeOf<undefined>();
		expectTypeOf<EventOutputMap<typeof events>["session_started"]>().toEqualTypeOf<
			Record<never, never>
		>();
		expectTypeOf<EventInputMap<typeof events>["form_submitted"]>().toEqualTypeOf<{
			rawValue: string;
		}>();
		expectTypeOf<EventOutputMap<typeof events>["form_submitted"]>().toEqualTypeOf<{
			normalizedValue: string;
		}>();
		expectTypeOf<(typeof events)["buttonClicked"]["category"]>().toEqualTypeOf<"engagement">();
	});

	it("provides readable client and server track tuples", () => {
		expectTypeOf<ClientTrackArgs<typeof events, "button_clicked">>().toEqualTypeOf<
			[eventName: "button_clicked", properties: ClickProperties]
		>();
		expectTypeOf<ClientTrackArgs<typeof events, "session_started">>().toEqualTypeOf<
			[eventName: "session_started"]
		>();
		expectTypeOf<
			ServerTrackArgs<typeof events, "button_clicked", { flush?: boolean }>
		>().toEqualTypeOf<
			[
				eventName: "button_clicked",
				properties: ClickProperties,
				options?: { flush?: boolean },
			]
		>();
		expectTypeOf<
			ServerTrackArgs<typeof events, "session_started", { flush?: boolean }>
		>().toEqualTypeOf<
			| [eventName: "session_started"]
			| [eventName: "session_started", options: { flush?: boolean }]
		>();
	});

	it("creates frozen Standard Typed marker objects without validation", () => {
		const typeMarker = typed<ClickProperties>();
		const noneMarker = noProperties();

		expect(typeMarker).toEqual({
			kind: "type",
			"~standard": { version: 1, vendor: "trakoo" },
		});
		expect(noneMarker).toEqual({
			kind: "none",
			"~standard": { version: 1, vendor: "trakoo" },
		});
		expect(Object.isFrozen(typeMarker)).toBe(true);
		expect(Object.isFrozen(noneMarker)).toBe(true);
		expect("validate" in typeMarker).toBe(false);
		expect("validate" in noneMarker).toBe(false);
	});

	it("recognizes markers and Standard Schema values", () => {
		expect(isTypeMarker(typed<ClickProperties>())).toBe(true);
		expect(isTypeMarker(noProperties())).toBe(false);
		expect(isNoPropertiesMarker(noProperties())).toBe(true);
		expect(isNoPropertiesMarker(typed<ClickProperties>())).toBe(false);
		expect(isStandardSchema(z.object({ value: z.string() }))).toBe(true);
		expect(isStandardSchema(typed<ClickProperties>())).toBe(false);
		expect(isStandardSchema({})).toBe(false);
	});
});

describe("event registry", () => {
	it("rejects duplicate emitted event names", () => {
		expect(() =>
			defineEvents({
				first: {
					name: "duplicate",
					category: "engagement",
					properties: noProperties(),
				},
				second: {
					name: "duplicate",
					category: "user",
					properties: noProperties(),
				},
			}),
		).toThrow(/duplicate event name/i);
	});

	it("stores private registry metadata as a non-enumerable property", () => {
		expect(Object.keys(events)).toEqual([
			"buttonClicked",
			"sessionStarted",
			"formSubmitted",
		]);

		const registrySymbol = Reflect.ownKeys(events).find(
			(key): key is symbol => typeof key === "symbol",
		);
		expect(registrySymbol).toBeTypeOf("symbol");
		expect(Object.getOwnPropertyDescriptor(events, registrySymbol as symbol)).toMatchObject({
			enumerable: false,
			writable: false,
		});
	});

	it("looks up event definitions by emitted name", () => {
		expect(getEventDefinition(events, "button_clicked")).toBe(events.buttonClicked);
		expect(getEventDefinition(events, "missing_event")).toBeUndefined();
	});
});

// @ts-expect-error typed<T>() rejects primitive property types
typed<string>();
// @ts-expect-error typed<T>() rejects array property types
typed<string[]>();
// @ts-expect-error typed<T>() rejects callable property types
typed<() => void>();

// Standard Schema event properties must have object inputs and outputs.
// @ts-expect-error primitive Standard Schema input is rejected
defineEvents({ invalid: { name: "invalid", category: "user", properties: z.string() } });
defineEvents({
	invalid: {
		name: "invalid",
		category: "user",
		// @ts-expect-error array Standard Schema input is rejected
		properties: z.array(z.string()),
	},
});
defineEvents({
	invalid: {
		name: "invalid",
		category: "user",
		// @ts-expect-error callable Standard Schema input is rejected
		properties: z.custom<() => void>(),
	},
});
defineEvents({
	invalid: {
		name: "invalid",
		category: "user",
		// @ts-expect-error primitive Standard Schema output is rejected
		properties: z.object({ value: z.string() }).transform(({ value }) => value),
	},
});
defineEvents({
	invalid: {
		name: "invalid",
		category: "user",
		// @ts-expect-error array Standard Schema output is rejected
		properties: z.object({ value: z.string() }).transform(({ value }) => [value]),
	},
});
defineEvents({
	invalid: {
		name: "invalid",
		category: "user",
		// @ts-expect-error callable Standard Schema output is rejected
		properties: z.object({ value: z.string() }).transform(() => () => undefined),
	},
});
