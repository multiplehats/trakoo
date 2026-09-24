// Base provider for extending
export { BaseAnalyticsProvider } from "./base.provider.js";

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
	ProxyClientContext,
	ProxyEventV2,
	ProxyPayloadV2,
	ProxyTrackEventV2,
	ProxyIdentifyEventV2,
	ProxyPageViewEventV2,
	ProxyResetEventV2,
} from "./proxy/types.js";
