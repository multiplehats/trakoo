// Re-export core types
export * from "./types.js";
export * from "./schema.js";
export * from "./registry.js";
export * from "./validation.js";

// Generic type helpers for users to create their own strongly typed events
export type CreateEventDefinition<
	TName extends string,
	TProperties extends Record<string, unknown> = Record<string, unknown>,
> = {
	name: TName;
	category: import("./types.js").EventCategory;
	properties: TProperties;
};

// Helper to extract event names from a collection of events
export type ExtractEventNames<T extends Record<string, { name: string }>> =
	T[keyof T]["name"];

// Helper to extract properties for a specific event
export type ExtractEventPropertiesFromCollection<
	T extends Record<
		string,
		{ name: string; properties: Record<string, unknown> }
	>,
	TEventName extends ExtractEventNames<T>,
> = Extract<T[keyof T], { name: TEventName }>["properties"];

// Type for creating a collection of events
export type EventCollection<
	T extends Record<string, CreateEventDefinition<string>>,
> = T;

export type EventMapFromCollection<T> = T extends EventCollection<infer Events>
	? {
			[K in keyof Events as Events[K] extends { name: infer N }
				? N extends string
					? N
					: never
				: never]: Events[K] extends { properties: infer P } ? P : never;
		}
	: Record<string, Record<string, unknown>>;

// Generic types for any event system
export type AnyEventName = string;
export type AnyEventProperties = Record<string, unknown>;
