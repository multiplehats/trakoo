// Main server analytics
export {
	createServerAnalytics,
	ServerAnalytics,
	type ServerAnalyticsConfig,
	type ServerTrackOptions,
} from "@/server.js";

// Server-side providers
export { PostHogServerProvider } from "@/providers/posthog/server.js";
export type { PostHogOptions } from "posthog-node";

// Base provider for creating custom providers
export { BaseAnalyticsProvider } from "@/providers/base.provider.js";

// Type exports
export type {
	EventCategory,
	BaseEvent,
	EventContext,
	AnalyticsProvider,
	AnalyticsConfig,
} from "@/core/events/types.js";

export type {
	CreateEventDefinition,
	ExtractEventNames,
	ExtractEventPropertiesFromCollection,
	EventCollection,
	AnyEventName,
	AnyEventProperties,
} from "@/core/events/index.js";
