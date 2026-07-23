import type { StandardSchemaV1, StandardTypedV1 } from "@standard-schema/spec";
import type { EventCategory } from "./types.js";
import {
	classifyEventProperties,
	type EventProperties,
	type EventPropertiesClassification,
	type NoPropertiesMarker,
	type PropertyObject,
} from "./schema.js";

export interface RuntimeEventDefinition<
	TName extends string = string,
	TProperties extends EventProperties = EventProperties,
> {
	readonly name: TName;
	readonly category: EventCategory;
	readonly properties: TProperties;
}

export type EventDefinitions = Record<string, RuntimeEventDefinition>;

const registryBrand: unique symbol = Symbol("trakoo.eventRegistry");

const classificationsByRegistry = new WeakMap<
	object,
	ReadonlyMap<string, EventPropertiesClassification>
>();

export type EventRegistry<T extends EventDefinitions> = T & {
	readonly [registryBrand]: ReadonlyMap<string, RuntimeEventDefinition>;
};

type ObjectPropertySchema<TProperties extends EventProperties> =
	TProperties extends StandardSchemaV1<infer TInput, infer TOutput>
		? PropertyObject<TInput> extends never
			? never
			: PropertyObject<TOutput> extends never
				? never
				: TProperties
		: TProperties;

type ObjectPropertyDefinitions<T extends EventDefinitions> = {
	readonly [K in keyof T]: {
		readonly properties: ObjectPropertySchema<T[K]["properties"]>;
	};
};

export function defineEvents<const T extends EventDefinitions>(
	definitions: T & ObjectPropertyDefinitions<T>,
): EventRegistry<T> {
	const definitionsByName = new Map<string, RuntimeEventDefinition>();
	const classificationsByName = new Map<
		string,
		EventPropertiesClassification
	>();

	for (const definition of Object.values(definitions)) {
		if (definitionsByName.has(definition.name)) {
			throw new Error(`Duplicate event name: ${definition.name}`);
		}
		definitionsByName.set(definition.name, definition);
		// Classify once at definition time; classifyEventProperties is
		// exception-safe, so hostile schemas surface as "access_failure".
		classificationsByName.set(
			definition.name,
			classifyEventProperties(definition.properties),
		);
	}

	Object.defineProperty(definitions, registryBrand, {
		value: definitionsByName,
		enumerable: false,
		writable: false,
	});
	classificationsByRegistry.set(definitions, classificationsByName);

	return definitions as EventRegistry<T>;
}

export function getEventDefinition<T extends EventDefinitions>(
	registry: EventRegistry<T>,
	name: string,
): RuntimeEventDefinition | undefined {
	return registry[registryBrand].get(name);
}

/** @internal Returns the classification cached at defineEvents() time; undefined for unknown events. */
export function getEventClassification<T extends EventDefinitions>(
	registry: EventRegistry<T>,
	name: string,
): EventPropertiesClassification | undefined {
	return classificationsByRegistry.get(registry)?.get(name);
}

type RegistryDefinitions<R extends EventRegistry<EventDefinitions>> =
	R extends EventRegistry<infer T> ? T : never;
type EventDefinitionOf<R extends EventRegistry<EventDefinitions>> =
	RegistryDefinitions<R>[keyof RegistryDefinitions<R>];

export type EventName<R extends EventRegistry<EventDefinitions>> =
	EventDefinitionOf<R>["name"];
type DefinitionForName<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
> = Extract<EventDefinitionOf<R>, { name: N }>;
type PropertiesForName<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
> = DefinitionForName<R, N>["properties"];

type InputFor<TProperties extends EventProperties> =
	TProperties extends NoPropertiesMarker
		? undefined
		: StandardTypedV1.InferInput<TProperties>;
type OutputFor<TProperties extends EventProperties> =
	TProperties extends NoPropertiesMarker
		? Record<never, never>
		: StandardTypedV1.InferOutput<TProperties>;

export type EventInputMap<R extends EventRegistry<EventDefinitions>> = {
	[N in EventName<R>]: InputFor<PropertiesForName<R, N>>;
};

export type EventOutputMap<R extends EventRegistry<EventDefinitions>> = {
	[N in EventName<R>]: OutputFor<PropertiesForName<R, N>>;
};

export type ClientTrackArgs<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
> = EventInputMap<R>[N] extends undefined
	? [eventName: N]
	: [eventName: N, properties: EventInputMap<R>[N]];

export type ServerTrackArgs<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
	O,
> = EventInputMap<R>[N] extends undefined
	? [eventName: N] | [eventName: N, options: O]
	: [eventName: N, properties: EventInputMap<R>[N], options?: O];
