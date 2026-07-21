import type {
	AnalyticsConfig,
	AnalyticsProvider,
	BaseEvent,
	EventCategory,
	EventContext,
	ProviderConfigOrProvider,
	ProviderMethod,
} from "@/core/events/types.js";
import { isBrowser } from "@/utils/environment";

// Default event map type
type DefaultEventMap = Record<string, Record<string, unknown>>;

/**
 * Internal normalized provider configuration
 */
interface NormalizedProviderConfig {
	provider: AnalyticsProvider;
	enabledMethods: Set<ProviderMethod>;
	enabledEvents?: Set<string>;
	excludedEvents?: Set<string>;
	eventPatterns?: RegExp[];
}

export class BrowserAnalytics<
	TEventMap extends DefaultEventMap = DefaultEventMap,
	TUserTraits extends Record<string, unknown> = Record<string, unknown>,
> {
	private providerConfigs: NormalizedProviderConfig[] = [];
	private context: EventContext<TUserTraits> = {};
	private userId?: string;
	private sessionId?: string;
	private userTraits?: TUserTraits;
	private initialized = false;
	private initializePromise?: Promise<void>;

	/**
	 * Creates a new BrowserAnalytics instance for client-side event tracking.
	 *
	 * Automatically generates a session ID and sets up the analytics context.
	 * The instance will be ready to track events once initialized.
	 *
	 * @param config Analytics configuration including providers and default context
	 * @param config.providers Array of analytics provider instances (e.g., PostHogClientProvider)
	 * @param config.defaultContext Optional default context to include with all events
	 *
	 * @example
	 * ```typescript
	 * import { BrowserAnalytics } from 'trakoo/client';
	 * import { PostHogClientProvider } from 'trakoo/providers/client';
	 *
	 * const analytics = new BrowserAnalytics({
	 *   providers: [
	 *     new PostHogClientProvider({
	 *       apiKey: 'your-posthog-api-key',
	 *       api_host: 'https://app.posthog.com'
	 *     })
	 *   ],
	 *   defaultContext: {
	 *     app: { version: '1.0.0' }
	 *   }
	 * });
	 *
	 * await analytics.initialize();
	 * ```
	 */
	constructor(config: AnalyticsConfig) {
		this.providerConfigs = this.normalizeProviders(config.providers);

		// Set default context
		if (config.defaultContext) {
			this.context = { ...config.defaultContext } as EventContext<TUserTraits>;
		}

		// Generate session ID
		this.sessionId = this.generateSessionId();
	}

	/**
	 * Normalizes provider configurations into a consistent internal format
	 */
	private normalizeProviders(
		providers: ProviderConfigOrProvider[],
	): NormalizedProviderConfig[] {
		const allMethods: ProviderMethod[] = [
			"initialize",
			"identify",
			"track",
			"pageView",
			"pageLeave",
			"reset",
		];

		return providers.map((config) => {
			// Simple provider instance - enable all methods
			if ("initialize" in config && "track" in config) {
				return {
					provider: config as AnalyticsProvider,
					enabledMethods: new Set(allMethods),
				};
			}

			// Provider config with routing
			const providerConfig = config as {
				provider: AnalyticsProvider;
				methods?: ProviderMethod[];
				exclude?: ProviderMethod[];
				events?: string[];
				excludeEvents?: string[];
				eventPatterns?: string[];
			};

			// Validate mutually exclusive method options
			if (providerConfig.methods && providerConfig.exclude) {
				console.warn(
					`[Analytics] Provider ${providerConfig.provider.name} has both 'methods' and 'exclude' specified. Using 'methods' and ignoring 'exclude'.`,
				);
			}

			// Validate mutually exclusive event options
			if (providerConfig.events && providerConfig.excludeEvents) {
				console.warn(
					`[Analytics] Provider ${providerConfig.provider.name} has both 'events' and 'excludeEvents' specified. Using 'events' and ignoring 'excludeEvents'.`,
				);
			}
			if (providerConfig.events && providerConfig.eventPatterns) {
				console.warn(
					`[Analytics] Provider ${providerConfig.provider.name} has both 'events' and 'eventPatterns' specified. Using 'events' and ignoring 'eventPatterns'.`,
				);
			}
			if (providerConfig.excludeEvents && providerConfig.eventPatterns) {
				console.warn(
					`[Analytics] Provider ${providerConfig.provider.name} has both 'excludeEvents' and 'eventPatterns' specified. Using 'eventPatterns' and ignoring 'excludeEvents'.`,
				);
			}

			let enabledMethods: Set<ProviderMethod>;

			if (providerConfig.methods) {
				// Only enable specified methods
				enabledMethods = new Set(providerConfig.methods);
			} else if (providerConfig.exclude) {
				// Enable all methods except excluded ones
				enabledMethods = new Set(
					allMethods.filter(
						(method) => !providerConfig.exclude?.includes(method),
					),
				);
			} else {
				// No routing config - enable all methods
				enabledMethods = new Set(allMethods);
			}

			// Process event filtering options
			let enabledEvents: Set<string> | undefined;
			let excludedEvents: Set<string> | undefined;
			let eventPatterns: RegExp[] | undefined;

			if (providerConfig.events && providerConfig.events.length > 0) {
				// Whitelist specific events
				enabledEvents = new Set(providerConfig.events);
			} else if (
				providerConfig.eventPatterns &&
				providerConfig.eventPatterns.length > 0
			) {
				// Compile glob patterns into regex
				eventPatterns = providerConfig.eventPatterns.map((pattern) => {
					// Convert glob pattern to regex: * -> .*
					const regexPattern = pattern.replace(/\*/g, ".*");
					return new RegExp(`^${regexPattern}$`);
				});
			} else if (
				providerConfig.excludeEvents &&
				providerConfig.excludeEvents.length > 0
			) {
				// Blacklist specific events
				excludedEvents = new Set(providerConfig.excludeEvents);
			}

			return {
				provider: providerConfig.provider,
				enabledMethods,
				enabledEvents,
				excludedEvents,
				eventPatterns,
			};
		});
	}

	/**
	 * Checks if a method should be called on a provider based on routing configuration
	 */
	private shouldCallMethod(
		config: NormalizedProviderConfig,
		method: ProviderMethod,
	): boolean {
		return config.enabledMethods.has(method);
	}

	/**
	 * Checks if an event should be tracked on a provider based on event filtering configuration
	 */
	private shouldTrackEvent(
		config: NormalizedProviderConfig,
		eventName: string,
	): boolean {
		// If no event filtering is configured, allow all events
		if (
			!config.enabledEvents &&
			!config.excludedEvents &&
			!config.eventPatterns
		) {
			return true;
		}

		// If whitelist is specified, only allow events in the set
		if (config.enabledEvents) {
			return config.enabledEvents.has(eventName);
		}

		// If patterns are specified, check if event matches any pattern
		if (config.eventPatterns) {
			return config.eventPatterns.some((pattern) => pattern.test(eventName));
		}

		// If blacklist is specified, allow all events except those in the set
		if (config.excludedEvents) {
			return !config.excludedEvents.has(eventName);
		}

		return true;
	}

	/**
	 * Initializes all analytics providers and sets up browser context.
	 *
	 * This method must be called before tracking events. It initializes all configured
	 * providers and automatically captures browser context including page information,
	 * device type, OS, and browser details.
	 *
	 * The method is safe to call multiple times and will not re-initialize if already done.
	 * If called while initialization is in progress, it returns the existing promise.
	 *
	 * @returns Promise that resolves when initialization is complete
	 *
	 * @example
	 * ```typescript
	 * const analytics = new BrowserAnalytics({ providers: [] });
	 *
	 * // Initialize before tracking events
	 * await analytics.initialize();
	 *
	 * // Now ready to track events
	 * analytics.track('page_viewed', { page: '/dashboard' });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Safe to call multiple times
	 * await analytics.initialize(); // First call does the work
	 * await analytics.initialize(); // Subsequent calls return immediately
	 * ```
	 */
	async initialize(): Promise<void> {
		if (!isBrowser()) return;

		if (this.initialized) return;

		// If already initializing, return the existing promise
		if (this.initializePromise) return this.initializePromise;

		this.initializePromise = this._doInitialize();
		return this.initializePromise;
	}

	private async _doInitialize(): Promise<void> {
		// Initialize all providers (initialize is always called regardless of routing)
		const initPromises = this.providerConfigs.map((config) =>
			config.provider.initialize(),
		);

		await Promise.all(initPromises);
		this.initialized = true;

		// Set browser context
		this.updateContext({
			page: {
				path: window.location.pathname,
				title: document.title,
				referrer: document.referrer,
			},
			device: {
				type: this.getDeviceType(),
				os: this.getOS(),
				browser: this.getBrowser(),
			},
		});
	}

	private async ensureInitialized(): Promise<void> {
		if (!this.initialized && !this.initializePromise) {
			await this.initialize();
		} else if (this.initializePromise) {
			await this.initializePromise;
		}
	}

	/**
	 * Identifies a user with optional traits.
	 *
	 * Associates subsequent events with the specified user ID and optionally
	 * sets user properties. This method should be called when a user logs in
	 * or when you want to associate events with a known user.
	 *
	 * **User Context (New):** User data (userId, email, traits) is automatically stored
	 * and included in all subsequent `track()` calls. This makes it easy for providers
	 * like Loops, Customer.io, or Intercom to access user information without passing
	 * it manually each time. The data is cleared when `reset()` is called (e.g., on logout).
	 *
	 * The method automatically ensures initialization but doesn't block execution
	 * if initialization is still in progress.
	 *
	 * @param userId Unique identifier for the user (e.g., database ID, email)
	 * @param traits Optional user properties and characteristics (email, name, plan, etc.)
	 *
	 * @example
	 * ```typescript
	 * // Basic user identification
	 * analytics.identify('user-123');
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Identify with user traits (recommended - enables email-based providers)
	 * analytics.identify('user-123', {
	 *   email: 'john@example.com',
	 *   name: 'John Doe',
	 *   plan: 'pro',
	 *   signupDate: '2024-01-15',
	 *   preferences: {
	 *     newsletter: true,
	 *     notifications: false
	 *   }
	 * });
	 *
	 * // Now all subsequent track() calls automatically include user context
	 * analytics.track('button_clicked', { buttonId: 'checkout' });
	 * // Providers receive: context.user = { userId: 'user-123', email: 'john@example.com', traits: {...} }
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In a login handler
	 * async function handleLogin(email: string, password: string) {
	 *   const user = await login(email, password);
	 *
	 *   // Identify user with full traits
	 *   analytics.identify(user.id, {
	 *     email: user.email,
	 *     name: user.name,
	 *     plan: user.plan,
	 *     company: user.company,
	 *     lastLogin: new Date().toISOString()
	 *   });
	 *
	 *   // All subsequent events now include this user context automatically
	 * }
	 *
	 * // In a logout handler - clear user context
	 * async function handleLogout() {
	 *   analytics.reset(); // Clears userId and traits
	 * }
	 * ```
	 */
	identify(userId: string, traits?: TUserTraits): void {
		this.userId = userId;
		this.userTraits = traits;

		// Run initialization if needed, but don't block
		this.ensureInitialized().catch((error) => {
			console.error("[Analytics] Failed to initialize during identify:", error);
		});

		for (const config of this.providerConfigs) {
			if (this.shouldCallMethod(config, "identify")) {
				config.provider.identify(userId, traits);
			}
		}
	}

	/**
	 * Tracks a custom event with properties.
	 *
	 * This is the main method for tracking user interactions and business events.
	 * The method ensures initialization before tracking and sends the event to all
	 * configured providers. Events are enriched with context information like
	 * timestamp, user ID, session ID, and browser context.
	 *
	 * **User Context (New):** If `identify()` was called previously, user data (userId,
	 * email, traits) is automatically included in the event context sent to all providers.
	 * This happens transparently - you don't need to pass user data manually.
	 *
	 * If providers are configured, the method waits for all providers to complete
	 * tracking. Failed providers don't prevent others from succeeding.
	 *
	 * @param eventName Name of the event to track (must match your event definitions)
	 * @param properties Event-specific properties and data
	 * @returns Promise that resolves when tracking is complete for all providers
	 *
	 * @example
	 * ```typescript
	 * // Track a simple event
	 * await analytics.track('button_clicked', {
	 *   buttonId: 'signup-cta',
	 *   page: '/landing'
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // User context is automatically included after identify()
	 * analytics.identify('user-123', {
	 *   email: 'user@example.com',
	 *   plan: 'pro'
	 * });
	 *
	 * // Now all events automatically include user context
	 * analytics.track('button_clicked', { buttonId: 'checkout' });
	 * // Providers receive: context.user = { userId: 'user-123', email: 'user@example.com', traits: {...} }
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Track a purchase event
	 * await analytics.track('purchase_completed', {
	 *   orderId: 'order-123',
	 *   amount: 99.99,
	 *   currency: 'USD',
	 *   items: [
	 *     { id: 'item-1', name: 'Product A', price: 49.99 },
	 *     { id: 'item-2', name: 'Product B', price: 49.99 }
	 *   ],
	 *   paymentMethod: 'credit_card'
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Fire-and-forget for non-critical events (client-side typical usage)
	 * analytics.track('feature_viewed', { feature: 'dashboard' });
	 * // Don't await - let it track in the background
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Error handling
	 * try {
	 *   await analytics.track('critical_event', { data: 'important' });
	 * } catch (error) {
	 *   // Individual provider failures are handled internally
	 *   // This catch would only trigger for initialization failures
	 *   console.error('Failed to track event:', error);
	 * }
	 * ```
	 */
	async track<TEventName extends keyof TEventMap & string>(
		eventName: TEventName,
		properties: TEventMap[TEventName],
	): Promise<void> {
		// Ensure initialization but don't block the track call
		await this.ensureInitialized();

		const event: BaseEvent = {
			action: eventName,
			category: this.getCategoryFromEventName(eventName),
			properties: properties as Record<string, unknown>,
			timestamp: Date.now(),
			userId: this.userId,
			sessionId: this.sessionId,
		};

		// Build context with user data
		const contextWithUser: EventContext<TUserTraits> = {
			...this.context,
			user:
				this.userId || this.userTraits
					? {
							userId: this.userId,
							email:
								this.userTraits && "email" in this.userTraits
									? (this.userTraits.email as string | undefined)
									: undefined,
							traits: this.userTraits,
						}
					: undefined,
		};

		// Track with all providers in parallel (respecting method and event routing)
		const trackPromises = this.providerConfigs
			.filter(
				(config) =>
					this.shouldCallMethod(config, "track") &&
					this.shouldTrackEvent(config, eventName),
			)
			.map(async (config) => {
				try {
					await config.provider.track(event, contextWithUser);
				} catch (error) {
					// Log error but don't throw - one provider failing shouldn't break others
					console.error(
						`[Analytics] Provider ${config.provider.name} failed to track event:`,
						error,
					);
				}
			});

		// Wait for all providers to complete
		await Promise.all(trackPromises);
	}

	/**
	 * Tracks a page view event.
	 *
	 * Automatically captures current page information (path, title, referrer) and
	 * updates the analytics context. This method should be called when users
	 * navigate to a new page or view.
	 *
	 * The method automatically ensures initialization but doesn't block execution
	 * if initialization is still in progress.
	 *
	 * @param properties Optional properties to include with the page view
	 *
	 * @example
	 * ```typescript
	 * // Basic page view tracking
	 * analytics.pageView();
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Page view with additional properties
	 * analytics.pageView({
	 *   category: 'product',
	 *   productId: 'prod-123',
	 *   loadTime: 1200,
	 *   source: 'organic_search'
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In a SvelteKit app with automatic navigation tracking
	 * import { afterNavigate } from '$app/navigation';
	 *
	 * afterNavigate(() => {
	 *   analytics.pageView({
	 *     timestamp: Date.now(),
	 *     userAgent: navigator.userAgent
	 *   });
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In a React app with React Router
	 * import { useEffect } from 'react';
	 * import { useLocation } from 'react-router-dom';
	 *
	 * function usePageTracking() {
	 *   const location = useLocation();
	 *
	 *   useEffect(() => {
	 *     analytics.pageView({
	 *       path: location.pathname,
	 *       search: location.search
	 *     });
	 *   }, [location]);
	 * }
	 * ```
	 */
	pageView(properties?: Record<string, unknown>): void {
		// Run initialization if needed, but don't block
		this.ensureInitialized().catch((error) => {
			console.error("[Analytics] Failed to initialize during pageView:", error);
		});

		// Update page context
		this.updateContext({
			page: {
				path: window.location.pathname,
				title: document.title,
				referrer: document.referrer,
			},
		});

		for (const config of this.providerConfigs) {
			if (this.shouldCallMethod(config, "pageView")) {
				config.provider.pageView(properties, this.context);
			}
		}
	}

	/**
	 * Tracks when a user leaves a page.
	 *
	 * This method should be called before navigation to track user engagement
	 * and session duration. It's useful for understanding how long users spend
	 * on different pages and their navigation patterns.
	 *
	 * Note: Not all analytics providers support page leave events. The method
	 * will only call providers that implement the pageLeave method.
	 *
	 * @param properties Optional properties to include with the page leave event
	 *
	 * @example
	 * ```typescript
	 * // Basic page leave tracking
	 * analytics.pageLeave();
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Page leave with engagement metrics
	 * analytics.pageLeave({
	 *   timeOnPage: 45000, // 45 seconds
	 *   scrollDepth: 80, // percentage
	 *   interactions: 3, // number of clicks/interactions
	 *   exitIntent: true // detected exit intent
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In a SvelteKit app with automatic navigation tracking
	 * import { beforeNavigate } from '$app/navigation';
	 *
	 * let pageStartTime = Date.now();
	 *
	 * beforeNavigate(() => {
	 *   analytics.pageLeave({
	 *     duration: Date.now() - pageStartTime,
	 *     exitType: 'navigation'
	 *   });
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Track page leave on browser unload
	 * window.addEventListener('beforeunload', () => {
	 *   analytics.pageLeave({
	 *     exitType: 'browser_close',
	 *     sessionDuration: Date.now() - sessionStartTime
	 *   });
	 * });
	 * ```
	 */
	pageLeave(properties?: Record<string, unknown>): void {
		// Run initialization if needed, but don't block
		this.ensureInitialized().catch((error) => {
			console.error(
				"[Analytics] Failed to initialize during pageLeave:",
				error,
			);
		});

		for (const config of this.providerConfigs) {
			if (
				this.shouldCallMethod(config, "pageLeave") &&
				config.provider.pageLeave
			) {
				config.provider.pageLeave(properties, this.context);
			}
		}
	}

	/**
	 * Resets the analytics state, clearing user ID and generating a new session.
	 *
	 * This method should be called when a user logs out or when you want to
	 * start tracking a new user session. It clears the current user ID,
	 * generates a new session ID, and calls reset on all providers.
	 *
	 * Use this method to ensure user privacy and accurate session tracking
	 * when users switch accounts or log out.
	 *
	 * @example
	 * ```typescript
	 * // Basic reset on logout
	 * analytics.reset();
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In a logout handler
	 * async function handleLogout() {
	 *   // Track logout event before resetting
	 *   await analytics.track('user_logged_out', {
	 *     sessionDuration: Date.now() - sessionStartTime
	 *   });
	 *
	 *   // Reset analytics state
	 *   analytics.reset();
	 *
	 *   // Clear user data and redirect
	 *   clearUserData();
	 *   window.location.href = '/login';
	 * }
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Account switching scenario
	 * async function switchAccount(newUserId: string) {
	 *   // Reset to clear previous user
	 *   analytics.reset();
	 *
	 *   // Identify the new user
	 *   analytics.identify(newUserId);
	 *
	 *   // Track account switch
	 *   analytics.track('account_switched', {
	 *     newUserId,
	 *     timestamp: Date.now()
	 *   });
	 * }
	 * ```
	 */
	reset(): void {
		this.userId = undefined;
		this.userTraits = undefined;
		this.sessionId = this.generateSessionId();
		for (const config of this.providerConfigs) {
			if (this.shouldCallMethod(config, "reset")) {
				config.provider.reset();
			}
		}
	}

	/**
	 * Manually flush all queued events to providers.
	 *
	 * This method is useful when you need to ensure events are sent immediately,
	 * such as before navigation or critical user actions. Providers that support
	 * batching (like ProxyProvider) will flush their queues when this is called.
	 *
	 * If `useBeacon` is true, providers that support it will use the Beacon API
	 * for more reliable delivery during page unload.
	 *
	 * @param useBeacon Whether to use the Beacon API for flushing (default: false)
	 * @returns Promise that resolves when all providers have flushed
	 *
	 * @example
	 * ```typescript
	 * // Flush before navigation
	 * analytics.track('button_clicked', { buttonId: 'checkout' });
	 * await analytics.flush();
	 * window.location.href = '/checkout';
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Flush with beacon API before page unload
	 * await analytics.flush(true);
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Ensure critical events are sent immediately
	 * await analytics.track('purchase_completed', { orderId: '123' });
	 * await analytics.flush(); // Wait for confirmation
	 * showThankYouPage();
	 * ```
	 */
	async flush(useBeacon = false): Promise<void> {
		const flushPromises = this.providerConfigs.map(async (config) => {
			// Only call flush if the provider has the method
			if (config.provider.flush && typeof config.provider.flush === "function") {
				try {
					await config.provider.flush(useBeacon);
				} catch (error) {
					console.error(
						`[Analytics] Provider ${config.provider.name} failed to flush:`,
						error,
					);
				}
			}
		});

		await Promise.all(flushPromises);
	}

	/**
	 * Updates the analytics context with new information.
	 *
	 * The context is included with all tracked events and provides additional
	 * metadata about the user's environment, current page, device, and other
	 * relevant information. This method merges new context with existing context.
	 *
	 * Context typically includes page information, device details, UTM parameters,
	 * and custom application context.
	 *
	 * @param context Partial context to merge with existing context
	 * @param context.page Page-related context (path, title, referrer)
	 * @param context.device Device-related context (type, OS, browser)
	 * @param context.utm UTM campaign tracking parameters
	 * @param context.app Application-specific context
	 *
	 * @example
	 * ```typescript
	 * // Update page context
	 * analytics.updateContext({
	 *   page: {
	 *     path: '/dashboard',
	 *     title: 'User Dashboard',
	 *     referrer: 'https://google.com'
	 *   }
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Add UTM parameters from URL
	 * const urlParams = new URLSearchParams(window.location.search);
	 * analytics.updateContext({
	 *   utm: {
	 *     source: urlParams.get('utm_source') || undefined,
	 *     medium: urlParams.get('utm_medium') || undefined,
	 *     campaign: urlParams.get('utm_campaign') || undefined,
	 *     term: urlParams.get('utm_term') || undefined,
	 *     content: urlParams.get('utm_content') || undefined
	 *   }
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Update application context
	 * analytics.updateContext({
	 *   app: {
	 *     version: '2.1.0',
	 *     feature: 'beta-dashboard',
	 *     theme: 'dark'
	 *   },
	 *   device: {
	 *     screenWidth: window.innerWidth,
	 *     screenHeight: window.innerHeight,
	 *     timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
	 *   }
	 * });
	 * ```
	 */
	updateContext(context: Partial<EventContext<TUserTraits>>): void {
		this.context = {
			...this.context,
			...context,
			page: context.page
				? {
						path:
							context.page.path ||
							this.context.page?.path ||
							window.location.pathname,
						title: context.page.title || this.context.page?.title,
						referrer: context.page.referrer || this.context.page?.referrer,
					}
				: this.context.page,
			device: {
				...this.context.device,
				...context.device,
			},
			utm: {
				...this.context.utm,
				...context.utm,
			},
		};
	}

	private getCategoryFromEventName(eventName: string): EventCategory {
		// Extract category from event name pattern: category_action
		const parts = eventName.split("_");
		// Only use the first part as category if there's actually an underscore
		if (parts.length > 1 && parts[0]) {
			return parts[0];
		}

		return "engagement"; // Default fallback category
	}

	private generateSessionId(): string {
		return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
	}

	private getDeviceType(): string {
		const userAgent = navigator.userAgent;
		if (/tablet|ipad|playbook|silk/i.test(userAgent)) {
			return "tablet";
		}
		if (
			/mobile|iphone|ipod|android|blackberry|opera|mini|windows\sce|palm|smartphone|iemobile/i.test(
				userAgent,
			)
		) {
			return "mobile";
		}
		return "desktop";
	}

	private getOS(): string {
		const userAgent = navigator.userAgent;
		if (userAgent.indexOf("Win") !== -1) return "Windows";
		if (userAgent.indexOf("Mac") !== -1) return "macOS";
		if (userAgent.indexOf("Linux") !== -1) return "Linux";
		if (userAgent.indexOf("Android") !== -1) return "Android";
		if (userAgent.indexOf("iOS") !== -1) return "iOS";
		return "Unknown";
	}

	private getBrowser(): string {
		const userAgent = navigator.userAgent;
		if (userAgent.indexOf("Chrome") !== -1) return "Chrome";
		if (userAgent.indexOf("Safari") !== -1) return "Safari";
		if (userAgent.indexOf("Firefox") !== -1) return "Firefox";
		if (userAgent.indexOf("Edge") !== -1) return "Edge";
		return "Unknown";
	}
}
