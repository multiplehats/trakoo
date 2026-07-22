import { ServerAnalytics } from "@/adapters/server/server-analytics.js";
import type {
	EventDefinitions,
	EventRegistry,
} from "@/core/events/registry.js";
import type { InferMarker, TypeMarker } from "@/core/events/schema.js";
import type {
	EventContext,
	ProviderConfigOrProvider,
} from "@/core/events/types.js";
import type { ValidationConfig } from "@/core/events/validation.js";

type ServerUserTraits<M extends TypeMarker<object> | undefined> =
	M extends undefined ? Record<string, unknown> : InferMarker<M>;

export interface ServerAnalyticsConfig<
	R extends EventRegistry<EventDefinitions>,
	M extends TypeMarker<object> | undefined = undefined,
> {
	readonly events: R;
	readonly userTraits?: M;
	readonly providers?: ProviderConfigOrProvider[];
	readonly validation?: ValidationConfig;
	readonly debug?: boolean;
	readonly enabled?: boolean;
	readonly defaultContext?: Partial<EventContext<ServerUserTraits<M>>>;
}

/**
 * Creates and initializes a fresh registry-bound server analytics instance.
 */
export function createServerAnalytics<
	R extends EventRegistry<EventDefinitions>,
	M extends TypeMarker<object> | undefined = undefined,
>(
	config: ServerAnalyticsConfig<R, M>,
): ServerAnalytics<R, ServerUserTraits<M>> {
	const analytics = new ServerAnalytics<R, ServerUserTraits<M>>({
		events: config.events,
		providers: config.providers ?? [],
		validation: config.validation,
		debug: config.debug,
		enabled: config.enabled,
		defaultContext: config.defaultContext,
	});
	analytics.initialize();

	return analytics;
}

export { ServerAnalytics };
export type { ServerTrackOptions } from "@/adapters/server/server-analytics.js";
