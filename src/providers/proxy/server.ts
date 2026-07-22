import type { EventContext } from "@/core/events/types.js";
import {
	getEventDefinition,
	type EventDefinitions,
	type EventName,
	type EventRegistry,
} from "@/core/events/registry.js";
import { isNoPropertiesMarker } from "@/core/events/schema.js";
import {
	serverAnalyticsRegistry,
	type ServerAnalytics,
	type ServerAnalyticsRegistryAccess,
	type ServerTrackOptions,
} from "@/adapters/server/server-analytics.js";
import type { ProxyPayload } from "./types.js";

/**
 * Configuration for ingesting proxy events
 */
export interface IngestProxyEventsConfig {
	/**
	 * Enrich context with server-side data
	 */
	enrichContext?: (request: Request) => Record<string, unknown>;

	/**
	 * Extract IP address from request
	 * Default: Uses standard headers (X-Forwarded-For, X-Real-IP)
	 */
	extractIp?: (request: Request) => string | undefined;

	/**
	 * Error handler
	 */
	onError?: (error: unknown) => void;
}

function isEmptyPropertyObject(value: unknown): value is object {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === 0
	);
}

/**
 * Ingests events from ProxyProvider and replays them through server analytics
 *
 * @example
 * ```typescript
 * // Next.js App Router
 * export async function POST(req: Request) {
 *   await ingestProxyEvents(req, serverAnalytics);
 *   return new Response('OK');
 * }
 *
 * // With custom IP extraction
 * export async function POST(req: Request) {
 *   await ingestProxyEvents(req, serverAnalytics, {
 *     extractIp: (req) => req.headers.get('cf-connecting-ip') // Cloudflare
 *   });
 *   return new Response('OK');
 * }
 * ```
 */
export async function ingestProxyEvents<
	TRegistry extends EventRegistry<EventDefinitions>,
	TUserTraits extends object = Record<string, unknown>,
>(
	request: Request,
	analytics: ServerAnalytics<TRegistry, TUserTraits>,
	config?: IngestProxyEventsConfig,
): Promise<void> {
	try {
		const payload = (await request.json()) as ProxyPayload;

		if (!payload.events || !Array.isArray(payload.events)) {
			throw new Error("Invalid payload: missing events array");
		}

		// Extract IP and enrich context
		const ip = config?.extractIp
			? config.extractIp(request)
			: extractIpFromRequest(request);

		// Extract user-agent from request headers
		const userAgent = request.headers.get("user-agent");

		const serverContext = config?.enrichContext
			? config.enrichContext(request)
			: {};

		// Process each event
		for (const event of payload.events) {
			try {
				switch (event.type) {
					case "track": {
						// Enrich context with server data
						const enrichedContext = {
							...event.context,
							...serverContext,
							server: {
								...event.context?.server,
								...(typeof serverContext?.server === "object" &&
								serverContext.server !== null
									? serverContext.server
									: {}),
								...(userAgent ? { userAgent } : {}),
							},
							device: {
								...event.context?.device,
								...(ip ? { ip } : {}),
							},
						} as EventContext<TUserTraits>;

						const eventName = event.event.action as EventName<TRegistry>;
						const options: ServerTrackOptions<TUserTraits> = {
							userId: event.event.userId,
							sessionId: event.event.sessionId,
							context: enrichedContext,
						};
						const definition = getEventDefinition(
							(
								analytics as unknown as ServerAnalyticsRegistryAccess<TRegistry>
							)[serverAnalyticsRegistry],
							event.event.action,
						);

						if (
							definition &&
							isNoPropertiesMarker(definition.properties) &&
							isEmptyPropertyObject(event.event.properties)
						) {
							const rawArguments = [eventName, options] as const;
							await analytics.track(...(rawArguments as never));
						} else {
							const rawArguments = [
								eventName,
								event.event.properties as never,
								options,
							] as const;
							await analytics.track(...(rawArguments as never));
						}
						break;
					}

					case "identify": {
						await analytics.identify(event.userId, event.traits as TUserTraits);
						break;
					}

					case "pageView": {
						// Enrich context with server data
						const enrichedContext = {
							...event.context,
							...serverContext,
							server: {
								...event.context?.server,
								...(typeof serverContext?.server === "object" &&
								serverContext.server !== null
									? serverContext.server
									: {}),
								...(userAgent ? { userAgent } : {}),
							},
							device: {
								...event.context?.device,
								...(ip ? { ip } : {}),
							},
						} as EventContext<TUserTraits>;

						await analytics.pageView(event.properties, {
							context: enrichedContext,
						});
						break;
					}

					case "reset": {
						// ServerAnalytics doesn't have a reset method
						// This is a client-side concept, so we skip it on the server
						break;
					}

					default: {
						console.warn("[Proxy] Unknown event type:", event);
					}
				}
			} catch (error) {
				if (config?.onError) {
					config.onError(error);
				} else {
					console.error("[Proxy] Failed to process event:", error);
				}
			}
		}
	} catch (error) {
		if (config?.onError) {
			config.onError(error);
		} else {
			console.error("[Proxy] Failed to ingest events:", error);
		}
		throw error;
	}
}

/**
 * Extracts IP address from standard proxy headers
 */
function extractIpFromRequest(request: Request): string | undefined {
	// Try standard headers in order of preference
	const headers = [
		"x-forwarded-for",
		"x-real-ip",
		"cf-connecting-ip", // Cloudflare
		"x-client-ip",
		"x-cluster-client-ip",
	];

	for (const header of headers) {
		const value = request.headers.get(header);
		if (value) {
			// X-Forwarded-For can be a comma-separated list, take the first one
			return value.split(",")[0]?.trim();
		}
	}

	return undefined;
}

/**
 * Creates a Request handler for common frameworks
 *
 * @example
 * ```typescript
 * // Next.js App Router
 * export const POST = createProxyHandler(serverAnalytics);
 *
 * // With custom config
 * export const POST = createProxyHandler(serverAnalytics, {
 *   extractIp: (req) => req.headers.get('cf-connecting-ip')
 * });
 * ```
 */
export function createProxyHandler<
	TRegistry extends EventRegistry<EventDefinitions>,
	TUserTraits extends object = Record<string, unknown>,
>(
	analytics: ServerAnalytics<TRegistry, TUserTraits>,
	config?: IngestProxyEventsConfig,
): (request: Request) => Promise<Response> {
	return async (request: Request) => {
		try {
			await ingestProxyEvents(request, analytics, config);
			return new Response("OK", { status: 200 });
		} catch (error) {
			console.error("[Proxy] Handler error:", error);
			return new Response("Internal Server Error", { status: 500 });
		}
	};
}
