// Server-only providers - Node.js only
export { BaseAnalyticsProvider } from "./base.provider.js";

// Pirsch server provider
export { PirschServerProvider } from "./pirsch/server.js";
export type { PirschServerConfig } from "./pirsch/server.js";

// Proxy helpers (for ingesting client-side events)
export {
	ingestProxyEvents,
	createProxyHandler,
	ProxyIngestError,
	ProxyTrustError,
} from "./proxy/server.js";
export type {
	IngestProxyEventsConfig,
	ProxyIngestErrorCode,
	ProxyTrustedIdentity,
	ProxyTrustErrorCode,
} from "./proxy/server.js";
export type {
	ProxyClientContext,
	ProxyEventV2,
	ProxyPayloadV2,
	ProxyTrackEventV2,
	ProxyIdentifyEventV2,
	ProxyPageViewEventV2,
	ProxyResetEventV2,
} from "./proxy/types.js";
