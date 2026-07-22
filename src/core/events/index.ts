// Re-export core types
export * from "./types.js";
export * from "./schema.js";
export * from "./registry.js";
export * from "./validation.js";

// Generic types for any event system
export type AnyEventName = string;
export type AnyEventProperties = Record<string, unknown>;
