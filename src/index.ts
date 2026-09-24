export type {
	AnalyticsConfig,
	AnalyticsProvider,
	BaseEvent,
	EventCategory,
	EventContext,
	PredefinedEventCategory,
	ProviderConfig,
	ProviderConfigOrProvider,
	ProviderMethod,
	ServerContext,
	TrackInvocation,
	UserContext,
} from "@/core/events/types.js";

export type {
	AnyEventName,
	AnyEventProperties,
} from "@/core/events/index.js";

export { defineEvents } from "@/core/events/registry.js";
export type {
	ClientTrackArgs,
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

// Base provider for provider packages and custom providers
export { BaseAnalyticsProvider } from "@/providers/base.provider.js";

export { AnalyticsValidationError } from "@/core/events/validation.js";
export type {
	AnalyticsValidationErrorCode,
	NormalizedValidationIssue,
	ValidationConfig,
} from "@/core/events/validation.js";
