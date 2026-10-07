// Predefined event categories
export type PredefinedEventCategory =
	| "engagement"
	| "user"
	| "navigation"
	| "error"
	| "performance"
	| "conversion";

// Allow custom categories while maintaining autocomplete
export type EventCategory =
	| PredefinedEventCategory
	| (string & Record<never, never>);

export interface BaseEvent<
	TProperties extends object = Record<string, unknown>,
> {
	category: EventCategory;
	action: string;
	timestamp?: number;
	userId?: string;
	sessionId?: string;
	properties?: TProperties;
	/**
	 * The groups the event belongs to, by group type: `{ company: "acme" }`.
	 * Set by server `track()`'s `groups` option.
	 */
	groups?: Readonly<Record<string, string>>;
}

/**
 * One group, such as a company or a workspace, as server `group()` hands it
 * to a provider.
 */
export interface GroupDescriptor {
	/** The group's kind, such as `company`. */
	readonly type: string;
	/** Unique among groups of its type. */
	readonly id: string;
	/** The group's properties. A provider routed with `pii: false` receives
	 * them without `name`, `email` and the other personal keys. */
	readonly traits?: Record<string, unknown>;
}

export interface UserContext<TTraits extends object = Record<string, unknown>> {
	userId?: string;
	email?: string;
	traits?: TTraits;
}

/**
 * Server-side context enrichment
 * Used by server analytics to add request-specific metadata
 */
export interface ServerContext {
	userAgent?: string;
	ip?: string;
	requestId?: string;
	timestamp?: number;
	[key: string]: unknown;
}

export interface EventContext<
	TTraits extends object = Record<string, unknown>,
> {
	user?: UserContext<TTraits>;
	page?: {
		path: string;
		title?: string;
		referrer?: string;
		url?: string;
		host?: string;
		protocol?: string;
		search?: string;
	};
	device?: {
		type?: string;
		os?: string;
		browser?: string;
		userAgent?: string;
		language?: string;
		timezone?: string;
		ip?: string;
		screen?: {
			width?: number;
			height?: number;
		};
		viewport?: {
			width?: number;
			height?: number;
		};
	};
	utm?: {
		source?: string;
		medium?: string;
		name?: string;
	};
	server?: ServerContext;
}

export interface TrackInvocation {
	readonly input: unknown;
	readonly inputProvided: boolean;
	readonly occurredAt: number;
}

export interface AnalyticsProvider {
	name: string;
	initialize(): Promise<void> | void;
	/**
	 * `context` is the request the identify came from, when the caller has
	 * one: a provider that places profiles by the caller's IP or user agent
	 * reads them from `context.server`.
	 */
	identify(
		userId: string,
		traits?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> | void;
	track(
		event: BaseEvent,
		context?: EventContext,
		invocation?: TrackInvocation,
	): Promise<void> | void;
	pageView(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> | void;
	pageLeave?(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> | void;
	reset(): Promise<void> | void;
	flush?(useBeacon?: boolean): Promise<void> | void;
	/**
	 * Creates or updates a group, and adds `userId` to it when given. Optional:
	 * a provider without it receives no group calls.
	 */
	group?(group: GroupDescriptor, userId?: string): Promise<void> | void;
}

/**
 * Provider methods that can be selectively enabled/disabled through routing
 */
export type ProviderMethod =
	| "initialize"
	| "identify"
	| "track"
	| "pageView"
	| "pageLeave"
	| "reset"
	| "group";

/**
 * Configuration for selective provider method routing and event filtering.
 * Allows you to control which methods are called on a specific provider
 * and which events are tracked.
 *
 * @example
 * ```typescript
 * // Only call track and identify, skip pageView
 * {
 *   provider: new BentoClientProvider({...}),
 *   methods: ['track', 'identify']
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Call all methods except pageView
 * {
 *   provider: new GoogleAnalyticsProvider({...}),
 *   exclude: ['pageView']
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Only track specific events (solves 1-to-50 problem)
 * {
 *   provider: new EmitKitServerProvider({...}),
 *   events: ['newsletter_signup', 'user_registered']
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Track all events except specific ones
 * {
 *   provider: new PostHogServerProvider({...}),
 *   excludeEvents: ['newsletter_signup']
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Use glob patterns to match multiple events
 * {
 *   provider: new EmitKitServerProvider({...}),
 *   eventPatterns: ['newsletter_*', 'user_*']
 * }
 * ```
 */
export interface ProviderConfig {
	/**
	 * The analytics provider instance
	 */
	provider: AnalyticsProvider;
	/**
	 * Only call these methods on this provider.
	 * If specified, all other methods will be skipped.
	 * Mutually exclusive with `exclude`.
	 */
	methods?: ProviderMethod[];
	/**
	 * Skip these methods on this provider.
	 * All other methods will be called normally.
	 * Mutually exclusive with `methods`.
	 */
	exclude?: ProviderMethod[];
	/**
	 * Only track these specific event names on this provider.
	 * If specified, all other events will be skipped.
	 * Mutually exclusive with `excludeEvents`.
	 *
	 * @example
	 * ```typescript
	 * {
	 *   provider: new EmitKitServerProvider({...}),
	 *   events: ['newsletter_signup'] // Only this event goes to EmitKit
	 * }
	 * ```
	 */
	events?: string[];
	/**
	 * Skip these specific event names on this provider.
	 * All other events will be tracked normally.
	 * Mutually exclusive with `events` and `eventPatterns`.
	 *
	 * @example
	 * ```typescript
	 * {
	 *   provider: new BentoClientProvider({...}),
	 *   excludeEvents: ['page_view'] // Everything except page views
	 * }
	 * ```
	 */
	excludeEvents?: string[];
	/**
	 * Glob-style patterns to match event names.
	 * Supports wildcards (*) for flexible event routing.
	 * Mutually exclusive with `excludeEvents`.
	 *
	 * @example
	 * ```typescript
	 * {
	 *   provider: new EmitKitServerProvider({...}),
	 *   eventPatterns: ['newsletter_*', 'user_registered']
	 *   // Matches: newsletter_signup, newsletter_unsubscribe, user_registered
	 * }
	 * ```
	 */
	eventPatterns?: string[];
	/**
	 * Whether this provider may receive personal data: `email`, `name`,
	 * `firstName`, `lastName` and `phone` in identify traits, and the email and
	 * those traits in an event's user context. Set `false` to keep them out of
	 * an analytics tool while an email tool such as Bento still receives them.
	 * The user id is always sent.
	 * @default true
	 *
	 * @example
	 * ```typescript
	 * {
	 *   provider: new OpenPanelServerProvider({...}),
	 *   pii: false
	 * }
	 * ```
	 */
	pii?: boolean;
}

/**
 * Provider configuration - supports both simple provider instances
 * and advanced routing configurations
 */
export type ProviderConfigOrProvider = AnalyticsProvider | ProviderConfig;

export interface AnalyticsConfig {
	providers: ProviderConfigOrProvider[];
	debug?: boolean;
	enabled?: boolean;
	defaultContext?: Partial<EventContext>;
}
