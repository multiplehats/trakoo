import { ServerAnalytics } from "@/adapters/server/server-analytics.js";
import type {
	AnalyticsConfig,
	ProviderConfigOrProvider,
} from "@/core/events/types.js";
import type {
	EventCollection,
	EventMapFromCollection,
} from "@/core/events/index.js";

export interface ServerAnalyticsConfig {
	providers?: ProviderConfigOrProvider[];
	debug?: boolean;
	enabled?: boolean;
}

/**
 * Create a server analytics instance
 *
 * @example
 * ```typescript
 * import { createServerAnalytics } from 'trackle/server';
 * import { PostHogServerProvider } from 'trackle/providers/posthog';
 * import { AppEvents } from './events';
 *
 * const analytics = createServerAnalytics<typeof AppEvents>({
 *   providers: [
 *     new PostHogServerProvider({
 *       apiKey: process.env.POSTHOG_API_KEY,
 *       host: process.env.POSTHOG_HOST
 *     })
 *   ],
 *   debug: true,
 *   enabled: true
 * });
 *
 * // Now event names and properties are fully typed!
 * await analytics.track('user_signed_up', {
 *   userId: 'user-123',
 *   email: 'user@example.com',
 *   plan: 'pro'
 * }, { userId: 'user-123' });
 * ```
 */
export function createServerAnalytics<
	TEvents = never,
	TUserTraits extends Record<string, unknown> = Record<string, unknown>,
>(
	config: ServerAnalyticsConfig,
): ServerAnalytics<EventMapFromCollection<TEvents>, TUserTraits> {
	const analyticsConfig: AnalyticsConfig = {
		providers: config.providers || [],
		debug: config.debug,
		enabled: config.enabled,
	};

	const analytics = new ServerAnalytics<
		EventMapFromCollection<TEvents>,
		TUserTraits
	>(analyticsConfig);
	analytics.initialize();

	return analytics;
}

export { ServerAnalytics };
