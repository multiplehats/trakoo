// Base provider for extending
export { BaseAnalyticsProvider } from "./base.provider.js";

// PostHog client provider only
export { PostHogClientProvider } from "./posthog/client.js";

// PostHog client types only
export type { PostHogConfig } from "posthog-js";

// OpenPanel client provider
export { OpenPanelClientProvider } from "./openpanel/client.js";
export type { OpenPanelClientConfig } from "./openpanel/client.js";

// Bento client provider
export { BentoClientProvider } from "./bento/client.js";
export type { BentoClientConfig } from "./bento/client.js";

// Pirsch client provider
export { PirschClientProvider } from "./pirsch/client.js";
export type { PirschClientConfig } from "./pirsch/client.js";

// Visitors client provider
export { VisitorsClientProvider } from "./visitors/client.js";
export type { VisitorsClientConfig } from "./visitors/client.js";

// Proxy provider (for server-side tracking via API endpoint)
export { ProxyProvider } from "./proxy/client.js";
export type { ProxyProviderConfig } from "./proxy/client.js";
export type {
	ProxyBatchConfig,
	ProxyRetryConfig,
	ProxyEvent,
	ProxyPayload,
	ProxyTrackEvent,
	ProxyIdentifyEvent,
	ProxyPageViewEvent,
	ProxyResetEvent,
} from "./proxy/types.js";
