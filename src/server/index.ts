// Main server analytics
export {
	createServerAnalytics,
	ServerAnalytics,
	type ServerAnalyticsConfig,
	type ServerTrackOptions,
} from "@/server.js";

export { defineEvents } from "@/core/events/registry.js";
export type {
	EventInputMap,
	EventName,
	EventOutputMap,
	EventRegistry,
	ServerTrackArgs,
} from "@/core/events/registry.js";

export { noProperties, typed } from "@/core/events/schema.js";
export type {
	NoPropertiesMarker,
	TypeMarker,
} from "@/core/events/schema.js";

export { AnalyticsValidationError } from "@/core/events/validation.js";
export type {
	AnalyticsValidationErrorCode,
	NormalizedValidationIssue,
	ValidationConfig,
} from "@/core/events/validation.js";

// Server-side providers
export { PostHogServerProvider } from "@/providers/posthog/server.js";
export type { PostHogOptions } from "posthog-node";

// Base provider for creating custom providers
export { BaseAnalyticsProvider } from "@/providers/base.provider.js";

// Type exports
export type {
	AnalyticsConfig,
	AnalyticsProvider,
	BaseEvent,
	EventCategory,
	EventContext,
	ProviderConfig,
	ProviderConfigOrProvider,
} from "@/core/events/types.js";

export type {
	AnyEventName,
	AnyEventProperties,
} from "@/core/events/index.js";
