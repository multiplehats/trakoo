import { BrowserAnalytics } from "@/adapters/client/browser-analytics.js";
import type {
	AnalyticsConfig,
	ProviderConfigOrProvider,
} from "@/core/events/types.js";
import type { EventMapFromCollection } from "@/core/events/index.js";

let analyticsInstance: BrowserAnalytics<
	Record<string, Record<string, unknown>>,
	Record<string, unknown>
> | null = null;

export interface ClientAnalyticsConfig {
	providers?: ProviderConfigOrProvider[];
	debug?: boolean;
	enabled?: boolean;
}

/**
 * Initialize analytics for the browser
 *
 * @example
 * ```typescript
 * import { createClientAnalytics } from 'trakoo/client';
 * import { PostHogClientProvider } from 'trakoo/providers/client';
 * import { AppEvents } from './events';
 *
 * const analytics = createClientAnalytics<typeof AppEvents>({
 *   providers: [
 *     new PostHogClientProvider({
 *       token: 'your-api-key',
 *       api_host: 'https://app.posthog.com'
 *     })
 *   ],
 *   debug: true,
 *   enabled: true
 * });
 *
 * // Now event names and properties are fully typed!
 * analytics.track('user_signed_up', {
 *   userId: 'user-123',
 *   email: 'user@example.com',
 *   plan: 'pro'
 * });
 * ```
 */
export function createClientAnalytics<
	TEvents = never,
	TUserTraits extends Record<string, unknown> = Record<string, unknown>,
>(
	config: ClientAnalyticsConfig,
): BrowserAnalytics<EventMapFromCollection<TEvents>, TUserTraits> {
	if (analyticsInstance) {
		console.warn("[Analytics] Already initialized");
		return analyticsInstance as BrowserAnalytics<
			EventMapFromCollection<TEvents>,
			TUserTraits
		>;
	}

	const analyticsConfig: AnalyticsConfig = {
		providers: config.providers || [],
		debug: config.debug,
		enabled: config.enabled,
	};

	analyticsInstance = new BrowserAnalytics<
		EventMapFromCollection<TEvents>,
		TUserTraits
	>(analyticsConfig) as BrowserAnalytics<
		Record<string, Record<string, unknown>>,
		Record<string, unknown>
	>;

	// Auto-initialize in the background without blocking
	analyticsInstance.initialize().catch((error) => {
		console.error("[Analytics] Failed to initialize:", error);
	});

	return analyticsInstance as BrowserAnalytics<
		EventMapFromCollection<TEvents>,
		TUserTraits
	>;
}

// Convenience export for backwards compatibility
export { createClientAnalytics as createAnalytics };

/**
 * Get the current analytics instance
 */
export function getAnalytics(): BrowserAnalytics<
	Record<string, Record<string, unknown>>,
	Record<string, unknown>
> {
	if (!analyticsInstance) {
		throw new Error(
			"[Analytics] Not initialized. Call createAnalytics() first.",
		);
	}
	return analyticsInstance;
}

/**
 * Convenience function to track events
 */
export function track(
	eventName: string,
	properties: Record<string, unknown>,
): Promise<void> {
	return getAnalytics().track(eventName, properties);
}

/**
 * Convenience function to identify users
 */
export function identify(
	userId: string,
	traits?: Record<string, unknown>,
): void {
	getAnalytics().identify(userId, traits);
}

/**
 * Convenience function to track page views
 */
export function pageView(properties?: Record<string, unknown>): void {
	getAnalytics().pageView(properties);
}

/**
 * Convenience function to track page leave events
 */
export function pageLeave(properties?: Record<string, unknown>): void {
	getAnalytics().pageLeave(properties);
}

/**
 * Convenience function to reset user session
 */
export function reset(): void {
	getAnalytics().reset();
}

/**
 * Convenience function to flush queued events
 */
export function flush(useBeacon = false): Promise<void> {
	return getAnalytics().flush(useBeacon);
}

/**
 * Reset the analytics instance (for testing purposes)
 * @internal
 */
export function resetAnalyticsInstance(): void {
	analyticsInstance = null;
}
