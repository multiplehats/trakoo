// Main client analytics
export {
	createClientAnalytics,
	type ClientAnalyticsConfig,
} from "@/client.js";

export { BrowserAnalytics } from "@/adapters/client/browser-analytics.js";

// Client-side providers
export { PostHogClientProvider } from "@/providers/posthog/client.js";
export type { PostHogConfig } from "posthog-js";

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
