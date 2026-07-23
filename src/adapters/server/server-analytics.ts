import {
	getEventClassification,
	type EventDefinitions,
	type EventName,
	type EventOutputMap,
	type EventRegistry,
	type ServerTrackArgs,
} from "@/core/events/registry.js";
import type {
	AnalyticsProvider,
	BaseEvent,
	EventContext,
	ProviderConfigOrProvider,
	ProviderMethod,
	UserContext,
} from "@/core/events/types.js";
import {
	AnalyticsValidationError,
	applyValidationFailurePolicy,
	resolveEvent,
	resolveReplayEvent,
	type ResolvedEvent,
	type ValidationConfig,
} from "@/core/events/validation.js";

export const serverAnalyticsReplay: unique symbol = Symbol(
	"trakoo.serverAnalytics.replay",
);

export interface ServerAnalyticsReplayAccess<TUserTraits extends object> {
	readonly [serverAnalyticsReplay]: (
		eventName: string,
		properties: unknown,
		options: ServerTrackOptions<TUserTraits> | undefined,
	) => Promise<void>;
}

export interface ServerTrackOptions<TUserTraits extends object> {
	readonly userId?: string;
	readonly sessionId?: string;
	readonly context?: EventContext<TUserTraits>;
	readonly user?: UserContext<TUserTraits>;
}

export interface ServerAnalyticsAdapterConfig<
	TRegistry extends EventRegistry<EventDefinitions>,
	TUserTraits extends object = Record<string, unknown>,
> {
	readonly events: TRegistry;
	readonly providers: ProviderConfigOrProvider[];
	readonly validation?: ValidationConfig;
	readonly debug?: boolean;
	readonly enabled?: boolean;
	readonly defaultContext?: Partial<EventContext<TUserTraits>>;
}

const serverTrackOptionKeys = new Set([
	"userId",
	"sessionId",
	"context",
	"user",
]);

function isServerTrackOptions<TUserTraits extends object>(
	value: unknown,
): value is ServerTrackOptions<TUserTraits> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).every((key) => serverTrackOptionKeys.has(key))
	);
}

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

export class ServerAnalytics<
	TRegistry extends EventRegistry<EventDefinitions>,
	TUserTraits extends object = Record<string, unknown>,
> implements ServerAnalyticsReplayAccess<TUserTraits>
{
	private providerConfigs: NormalizedProviderConfig[] = [];
	private initialized = false;
	private readonly registry: TRegistry;
	private readonly validation?: ValidationConfig;
	private readonly debug: boolean;
	private readonly enabled: boolean;
	private readonly defaultContext?: Partial<EventContext<TUserTraits>>;

	/**
	 * Creates a new ServerAnalytics instance for server-side event tracking.
	 *
	 * The server analytics instance is designed for Node.js environments including
	 * long-running servers, serverless functions, and edge computing environments.
	 *
	 * @param config Analytics configuration including an event registry, providers, and default context
	 * @param config.events Runtime event registry created with `defineEvents()`
	 * @param config.providers Array of analytics provider instances (e.g., PostHogServerProvider)
	 * @param config.defaultContext Optional default context to include with all events
	 *
	 * @example
	 * ```typescript
	 * import { defineEvents } from 'trakoo';
	 * import { ServerAnalytics } from 'trakoo/server';
	 * import { PostHogServerProvider } from 'trakoo/providers/server';
	 *
	 * const events = defineEvents({});
	 * const analytics = new ServerAnalytics({
	 *   events,
	 *   providers: [
	 *     new PostHogServerProvider({
	 *       apiKey: 'your-posthog-api-key',
	 *       host: 'https://app.posthog.com'
	 *     })
	 *   ],
	 *   defaultContext: {
	 *     server: { version: '1.0.0', environment: 'production' }
	 *   }
	 * });
	 *
	 * analytics.initialize();
	 * ```
	 */
	constructor(config: ServerAnalyticsAdapterConfig<TRegistry, TUserTraits>) {
		this.registry = config.events;
		this.validation = config.validation;
		this.debug = config.debug === true;
		this.enabled = config.enabled !== false;
		this.defaultContext = config.defaultContext;
		this.providerConfigs = this.normalizeProviders(config.providers);
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
	 * Initializes all analytics providers.
	 *
	 * This method must be called before tracking events. It initializes all configured
	 * providers synchronously. Unlike the browser version, server initialization is
	 * typically synchronous as providers don't need to load external scripts.
	 *
	 * The method is safe to call multiple times and will not re-initialize if already done.
	 *
	 * @example
	 * ```typescript
	 * import { defineEvents, typed } from 'trakoo';
	 * import { ServerAnalytics } from 'trakoo/server';
	 *
	 * const events = defineEvents({
	 *   apiRequest: {
	 *     name: 'api_request',
	 *     category: 'system',
	 *     properties: typed<{ endpoint: string }>(),
	 *   },
	 * });
	 * const analytics = new ServerAnalytics({ events, providers: [] });
	 *
	 * // Initialize before tracking events
	 * analytics.initialize();
	 *
	 * // Now ready to track events
	 * await analytics.track('api_request', { endpoint: '/users' });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * import { defineEvents, typed } from 'trakoo';
	 * import { ServerAnalytics } from 'trakoo/server';
	 *
	 * const events = defineEvents({
	 *   functionInvoked: {
	 *     name: 'function_invoked',
	 *     category: 'system',
	 *     properties: typed<{ path: string; method: string }>(),
	 *   },
	 * });
	 *
	 * // In a serverless function
	 * export async function handler(req, res) {
	 *   const analytics = new ServerAnalytics({ events, providers: [] });
	 *   analytics.initialize(); // Quick synchronous initialization
	 *
	 *   await analytics.track('function_invoked', {
	 *     path: req.path,
	 *     method: req.method
	 *   });
	 *
	 *   await analytics.shutdown(); // Important for serverless
	 * }
	 * ```
	 */
	initialize(): void {
		if (!this.enabled) return;
		if (this.initialized) return;

		// Initialize all providers synchronously (initialize is always called regardless of routing)
		for (const config of this.providerConfigs) {
			config.provider.initialize();
		}

		this.initialized = true;
	}

	/**
	 * Identifies a user with optional traits.
	 *
	 * Associates subsequent events with the specified user ID and optionally
	 * sets user properties. This method is typically called when processing
	 * authentication or when you have user context available on the server.
	 *
	 * @param userId Unique identifier for the user (e.g., database ID, email)
	 * @param traits Optional user properties and characteristics
	 *
	 * @example
	 * ```typescript
	 * // Basic user identification
	 * analytics.identify('user-123');
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Identify with user traits from database
	 * analytics.identify('user-123', {
	 *   email: 'john@example.com',
	 *   name: 'John Doe',
	 *   plan: 'enterprise',
	 *   company: 'Acme Corp',
	 *   createdAt: '2024-01-15T10:00:00Z',
	 *   lastSeenAt: new Date().toISOString()
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In an API authentication middleware
	 * async function authMiddleware(req, res, next) {
	 *   const user = await getUserFromToken(req.headers.authorization);
	 *
	 *   analytics.identify(user.id, {
	 *     email: user.email,
	 *     role: user.role,
	 *     organization: user.organization
	 *   });
	 *
	 *   req.user = user;
	 *   next();
	 * }
	 * ```
	 */
	async identify(userId: string, traits?: TUserTraits): Promise<void> {
		if (!this.enabled) return;

		const promises = this.providerConfigs
			.filter((config) => this.shouldCallMethod(config, "identify"))
			.map((config) =>
				config.provider.identify(
					userId,
					traits as Record<string, unknown> | undefined,
				),
			);

		const results = await Promise.allSettled(promises);

		for (const result of results) {
			if (result.status === "rejected") {
				throw result.reason;
			}
		}
	}

	/**
	 * Tracks a custom event with properties and optional context.
	 *
	 * This is the main method for tracking business events on the server side.
	 * The method sends the event to all configured providers and waits for completion.
	 * Failed providers don't prevent others from succeeding.
	 *
	 * Server-side tracking typically includes additional context like IP addresses,
	 * user agents, and server-specific metadata that isn't available on the client.
	 *
	 * **User Context (New):** You can now pass user data (email, traits) with each event
	 * via `options.user` or `options.context.user`. This is useful for providers like
	 * Loops, Customer.io, or Intercom that require user identifiers.
	 *
	 * @param eventName Name of the event to track (must match your event definitions)
	 * @param properties Event-specific properties and data
	 * @param options Optional configuration including user ID, session ID, user context, and additional context
	 * @param options.userId User ID to associate with this event
	 * @param options.sessionId Session ID to associate with this event
	 * @param options.user User context including email and traits (automatically included in event context)
	 * @param options.context Additional context for this event (page, device, etc.)
	 * @returns Promise that resolves when tracking is complete for all providers
	 *
	 * @example
	 * ```typescript
	 * // Basic event tracking
	 * await analytics.track('api_request', {
	 *   endpoint: '/api/users',
	 *   method: 'GET',
	 *   responseTime: 150,
	 *   statusCode: 200
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Track with user context (recommended for email-based providers)
	 * await analytics.track('purchase_completed', {
	 *   orderId: 'order-123',
	 *   amount: 99.99,
	 *   currency: 'USD',
	 *   itemCount: 3
	 * }, {
	 *   userId: 'user-456',
	 *   user: {
	 *     email: 'user@example.com',
	 *     traits: {
	 *       plan: 'pro',
	 *       company: 'Acme Corp'
	 *     }
	 *   },
	 *   context: {
	 *     page: { path: '/checkout/complete' },
	 *     device: { userAgent: req.headers['user-agent'] }
	 *   }
	 * });
	 * // Providers receive: context.user = { email: 'user@example.com', traits: {...} }
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Alternative: Pass user via context.user
	 * await analytics.track('feature_used', {
	 *   featureName: 'export'
	 * }, {
	 *   userId: 'user-123',
	 *   context: {
	 *     user: {
	 *       email: 'user@example.com'
	 *     },
	 *     page: { path: '/dashboard' }
	 *   }
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In an Express.js route handler with user data
	 * app.post('/api/users', async (req, res) => {
	 *   const user = await createUser(req.body);
	 *
	 *   // Track user creation with full user context
	 *   await analytics.track('user_created', {
	 *     userId: user.id,
	 *     email: user.email,
	 *     plan: user.plan
	 *   }, {
	 *     userId: user.id,
	 *     user: {
	 *       email: user.email,
	 *       traits: {
	 *         name: user.name,
	 *         plan: user.plan,
	 *         company: user.company
	 *       }
	 *     },
	 *     context: {
	 *       page: { path: req.path },
	 *       device: { userAgent: req.headers['user-agent'] }
	 *     }
	 *   });
	 *
	 *   res.json(user);
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Error handling in tracking
	 * try {
	 *   await analytics.track('payment_processed', {
	 *     amount: 100,
	 *     currency: 'USD'
	 *   });
	 * } catch (error) {
	 *   // Strict validation rejects with AnalyticsValidationError.
	 *   // Initialization errors happen during initialize(); provider track failures are isolated and logged.
	 *   console.error('Failed to track event:', error);
	 * }
	 * ```
	 */
	async track<TName extends EventName<TRegistry>>(
		...args: ServerTrackArgs<TRegistry, TName, ServerTrackOptions<TUserTraits>>
	): Promise<void> {
		if (!this.enabled) return;

		if (!this.initialized) {
			console.warn("[Analytics] Not initialized. Call initialize() first.");
			return;
		}

		const argumentValues: readonly unknown[] = args;
		const eventName = args[0];
		const classification = getEventClassification(this.registry, eventName);
		const secondArgument = argumentValues[1];
		let input = secondArgument;
		let inputProvided = args.length > 1;
		let options: ServerTrackOptions<TUserTraits> | undefined;

		if (classification?.kind === "none") {
			if (
				args.length === 2 &&
				isServerTrackOptions<TUserTraits>(secondArgument)
			) {
				options = secondArgument;
				input = undefined;
				inputProvided = false;
			} else if (args.length === 1) {
				input = undefined;
				inputProvided = false;
			} else if (args.length === 3 && secondArgument === undefined) {
				const thirdArgument = argumentValues[2];
				if (thirdArgument === undefined) {
					input = undefined;
					inputProvided = false;
				} else if (isServerTrackOptions<TUserTraits>(thirdArgument)) {
					options = thirdArgument;
					input = undefined;
					inputProvided = false;
				} else {
					await applyValidationFailurePolicy(
						new AnalyticsValidationError("invalid_options", eventName),
						this.validation,
						this.debug,
					);
					return;
				}
			}
		} else if (classification) {
			const thirdArgument = argumentValues[2];
			if (thirdArgument === undefined) {
				options = undefined;
			} else if (isServerTrackOptions<TUserTraits>(thirdArgument)) {
				options = thirdArgument;
			} else {
				await applyValidationFailurePolicy(
					new AnalyticsValidationError("invalid_options", eventName),
					this.validation,
					this.debug,
				);
				return;
			}
		}

		const resolved = await resolveEvent(
			this.registry,
			eventName,
			input,
			inputProvided,
			this.validation,
			this.debug,
		);
		if (!resolved) return;

		await this.dispatchResolvedEvent(resolved, options);
	}

	/**
	 * Replays an already-validated proxy event through the shared dispatch
	 * path. Internal entry point used by `ingestProxyEvents`; the replayed
	 * properties are the client's post-transform validator output, so they
	 * are resolved via `resolveReplayEvent` instead of being re-validated.
	 */
	async [serverAnalyticsReplay](
		eventName: string,
		properties: unknown,
		options: ServerTrackOptions<TUserTraits> | undefined,
	): Promise<void> {
		if (!this.enabled) return;

		if (!this.initialized) {
			console.warn("[Analytics] Not initialized. Call initialize() first.");
			return;
		}

		const resolved = await resolveReplayEvent(
			this.registry,
			eventName as EventName<TRegistry>,
			properties,
			this.validation,
			this.debug,
		);
		if (!resolved) return;

		await this.dispatchResolvedEvent(resolved, options);
	}

	/**
	 * Shared dispatch tail for track() and the proxy replay entry point:
	 * builds the BaseEvent, merges context, and fans out to providers.
	 */
	private async dispatchResolvedEvent<TName extends EventName<TRegistry>>(
		resolved: ResolvedEvent<TRegistry, TName>,
		options: ServerTrackOptions<TUserTraits> | undefined,
	): Promise<void> {
		const event: BaseEvent<EventOutputMap<TRegistry>[TName]> = {
			action: resolved.name,
			category: resolved.category,
			properties: resolved.properties,
			timestamp: Date.now(),
			userId: options?.userId,
			sessionId: options?.sessionId,
		};

		const context: EventContext<TUserTraits> = {
			...this.defaultContext,
			...options?.context,
			user:
				options?.user ?? options?.context?.user ?? this.defaultContext?.user,
		};

		// Track with all providers in parallel (respecting method and event routing)
		const trackPromises = this.providerConfigs
			.filter(
				(config) =>
					this.shouldCallMethod(config, "track") &&
					this.shouldTrackEvent(config, resolved.name),
			)
			.map(async (config) => {
				try {
					await config.provider.track(
						event as BaseEvent,
						context as EventContext,
					);
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
	 * Tracks a page view event from the server side.
	 *
	 * Server-side page view tracking is useful for server-rendered applications,
	 * SSR frameworks, or when you want to ensure page views are tracked even
	 * if client-side JavaScript fails.
	 *
	 * @param properties Optional properties to include with the page view
	 * @param options Optional configuration including context
	 * @param options.context Additional context for this page view
	 *
	 * @example
	 * ```typescript
	 * // Basic server-side page view
	 * analytics.pageView();
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Page view with server context
	 * analytics.pageView({
	 *   loadTime: 250,
	 *   template: 'product-detail',
	 *   ssr: true
	 * }, {
	 *   context: {
	 *     page: {
	 *       path: '/products/widget-123',
	 *       title: 'Amazing Widget - Product Details'
	 *     },
	 *     device: {
	 *       userAgent: req.headers['user-agent']
	 *     },
	 *     server: {
	 *       renderTime: 45,
	 *       cacheHit: false
	 *     }
	 *   }
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In a Next.js API route or middleware
	 * export async function middleware(req) {
	 *   if (req.nextUrl.pathname.startsWith('/product/')) {
	 *     analytics.pageView({
	 *       category: 'product',
	 *       productId: req.nextUrl.pathname.split('/').pop()
	 *     }, {
	 *       context: {
	 *         page: { path: req.nextUrl.pathname },
	 *         device: { userAgent: req.headers.get('user-agent') },
	 *         referrer: req.headers.get('referer')
	 *       }
	 *     });
	 *   }
	 * }
	 * ```
	 */
	async pageView(
		properties?: Record<string, unknown>,
		options?: {
			context?: EventContext<TUserTraits>;
		},
	): Promise<void> {
		if (!this.enabled) return;
		if (!this.initialized) return;

		const context: EventContext<TUserTraits> = {
			...this.defaultContext,
			...options?.context,
		};

		const promises = this.providerConfigs
			.filter((config) => this.shouldCallMethod(config, "pageView"))
			.map((config) =>
				config.provider.pageView(properties, context as EventContext),
			);

		const results = await Promise.allSettled(promises);

		for (const result of results) {
			if (result.status === "rejected") {
				throw result.reason;
			}
		}
	}

	/**
	 * Tracks when a user leaves a page from the server side.
	 *
	 * Server-side page leave tracking is less common than client-side but can be
	 * useful in certain scenarios like tracking session timeouts, or when combined
	 * with server-side session management.
	 *
	 * Note: Not all analytics providers support page leave events. The method
	 * will only call providers that implement the pageLeave method.
	 *
	 * @param properties Optional properties to include with the page leave event
	 * @param options Optional configuration including context
	 * @param options.context Additional context for this page leave
	 *
	 * @example
	 * ```typescript
	 * // Basic page leave tracking
	 * analytics.pageLeave();
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // Page leave with session context
	 * analytics.pageLeave({
	 *   sessionDuration: 45000, // 45 seconds
	 *   pagesViewed: 3,
	 *   exitReason: 'session_timeout'
	 * }, {
	 *   context: {
	 *     session: {
	 *       id: 'session-123',
	 *       startTime: sessionStartTime,
	 *       endTime: Date.now()
	 *     },
	 *     server: {
	 *       reason: 'inactivity_timeout'
	 *     }
	 *   }
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In a session cleanup job
	 * async function cleanupExpiredSessions() {
	 *   const expiredSessions = await getExpiredSessions();
	 *
	 *   for (const session of expiredSessions) {
	 *     analytics.pageLeave({
	 *       sessionId: session.id,
	 *       duration: session.duration,
	 *       reason: 'expired'
	 *     });
	 *
	 *     await removeSession(session.id);
	 *   }
	 * }
	 * ```
	 */
	pageLeave(
		properties?: Record<string, unknown>,
		options?: {
			context?: EventContext<TUserTraits>;
		},
	): void {
		if (!this.enabled) return;
		if (!this.initialized) return;

		const context: EventContext<TUserTraits> = {
			...this.defaultContext,
			...options?.context,
		};

		for (const config of this.providerConfigs) {
			if (
				this.shouldCallMethod(config, "pageLeave") &&
				config.provider.pageLeave
			) {
				config.provider.pageLeave(properties, context as EventContext);
			}
		}
	}

	/**
	 * Shuts down all analytics providers and flushes pending events.
	 *
	 * This method is crucial for server environments, especially serverless functions,
	 * as it ensures all events are sent before the process terminates. Some providers
	 * batch events and need an explicit flush to send them.
	 *
	 * Always call this method before your server shuts down or before a serverless
	 * function completes execution.
	 *
	 * @returns Promise that resolves when all providers have been shut down
	 *
	 * @example
	 * ```typescript
	 * // Basic shutdown
	 * await analytics.shutdown();
	 * ```
	 *
	 * @example
	 * ```typescript
	 * import { defineEvents, typed } from 'trakoo';
	 * import { ServerAnalytics } from 'trakoo/server';
	 *
	 * const events = defineEvents({
	 *   functionCompleted: {
	 *     name: 'function_completed',
	 *     category: 'system',
	 *     properties: typed<{ duration: number; success: boolean }>(),
	 *   },
	 *   functionFailed: {
	 *     name: 'function_failed',
	 *     category: 'error',
	 *     properties: typed<{ error: string; duration: number }>(),
	 *   },
	 * });
	 *
	 * // In a serverless function
	 * export async function handler(event, context) {
	 *   const analytics = new ServerAnalytics({ events, providers: [] });
	 *   analytics.initialize();
	 *
	 *   try {
	 *     // Process the event
	 *     await processEvent(event);
	 *
	 *     // Track completion
	 *     await analytics.track('function_completed', {
	 *       duration: Date.now() - startTime,
	 *       success: true
	 *     });
	 *   } catch (error) {
	 *     await analytics.track('function_failed', {
	 *       error: error.message,
	 *       duration: Date.now() - startTime
	 *     });
	 *   } finally {
	 *     // Always shutdown to flush events
	 *     await analytics.shutdown();
	 *   }
	 *
	 *   return { statusCode: 200 };
	 * }
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // In an Express.js server
	 * const server = app.listen(3000);
	 *
	 * // Graceful shutdown
	 * process.on('SIGTERM', async () => {
	 *   console.log('Shutting down gracefully...');
	 *
	 *   server.close(async () => {
	 *     // Flush analytics events before exit
	 *     await analytics.shutdown();
	 *     process.exit(0);
	 *   });
	 * });
	 * ```
	 *
	 * @example
	 * ```typescript
	 * // With Vercel's waitUntil
	 * import { waitUntil } from '@vercel/functions';
	 *
	 * export default async function handler(req, res) {
	 *   // Process request
	 *   const result = await processRequest(req);
	 *
	 *   // Track in background without blocking response
	 *   waitUntil(
	 *     analytics.track('api_request', { endpoint: req.url })
	 *       .then(() => analytics.shutdown())
	 *   );
	 *
	 *   return res.json(result);
	 * }
	 * ```
	 */
	async shutdown(): Promise<void> {
		if (!this.enabled) return;

		// Shutdown all providers that support it (note: shutdown is not routable, always called)
		const shutdownPromises = this.providerConfigs.map((config) => {
			if (
				"shutdown" in config.provider &&
				typeof config.provider.shutdown === "function"
			) {
				return config.provider.shutdown();
			}
			return Promise.resolve();
		});

		await Promise.all(shutdownPromises);
	}
}
