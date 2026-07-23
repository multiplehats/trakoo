import { BrowserAnalytics } from "@/adapters/client/browser-analytics.js";
import type {
	EventDefinitions,
	EventRegistry,
} from "@/core/events/registry.js";
import type { InferMarker, TypeMarker } from "@/core/events/schema.js";
import type { ProviderConfigOrProvider } from "@/core/events/types.js";
import type { ValidationConfig } from "@/core/events/validation.js";

type ClientUserTraits<M extends TypeMarker<object> | undefined> =
	M extends undefined ? Record<string, unknown> : InferMarker<M>;

export interface ClientAnalyticsConfig<
	R extends EventRegistry<EventDefinitions>,
	M extends TypeMarker<object> | undefined = undefined,
> {
	readonly events: R;
	readonly userTraits?: M;
	readonly providers?: ProviderConfigOrProvider[];
	readonly validation?: ValidationConfig;
	readonly debug?: boolean;
	readonly enabled?: boolean;
}

export function createClientAnalytics<
	R extends EventRegistry<EventDefinitions>,
	M extends TypeMarker<object> | undefined = undefined,
>(
	config: ClientAnalyticsConfig<R, M>,
): BrowserAnalytics<R, ClientUserTraits<M>> {
	const analytics = new BrowserAnalytics<R, ClientUserTraits<M>>({
		events: config.events,
		providers: config.providers ?? [],
		validation: config.validation,
		debug: config.debug,
		enabled: config.enabled,
	});

	analytics.initialize().catch((error: unknown) => {
		console.error("[Analytics] Failed to initialize:", error);
	});

	return analytics;
}
