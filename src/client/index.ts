// Main client analytics
export {
	createClientAnalytics,
	type ClientAnalyticsConfig,
} from "@/client.js";

export { defineEvents } from "@/core/events/registry.js";
export type {
	ClientTrackArgs,
	EventInputMap,
	EventName,
	EventOutputMap,
	EventRegistry,
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

export { BrowserAnalytics } from "@/adapters/client/browser-analytics.js";

// Client-side providers
export { PostHogClientProvider } from "@/providers/posthog/client.js";
export type { PostHogConfig } from "posthog-js";

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
