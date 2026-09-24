import {
	BaseAnalyticsProvider,
	type BaseEvent,
	type EventContext,
} from "trakoo";
import type { EmitKit } from "@emitkit/js";

const DEFAULT_TIMEOUT = 5000;

/** Identifies trakoo as the sender of each event in EmitKit. */
const EVENT_SOURCE = "trakoo";

// EmitKit rejects the whole event (HTTP 400) when a field exceeds these limits.
// https://api.emitkit.com/api/openapi.json, CreateEventRequest
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 5000;

const EMITKIT_ERROR_NAMES = new Set([
	"EmitKitError",
	"RateLimitError",
	"ValidationError",
]);

/**
 * Configuration for EmitKit server provider
 */
export interface EmitKitServerConfig {
	/**
	 * Your EmitKit API key (starts with emitkit_)
	 */
	apiKey: string;

	/**
	 * Request timeout in milliseconds
	 * @default 5000
	 */
	timeout?: number;

	/**
	 * Default channel name for events
	 * @default 'general'
	 */
	channelName?: string;

	/**
	 * Map event categories to specific EmitKit channels.
	 * Allows automatic routing of events to appropriate channels based on category.
	 *
	 * @example
	 * ```typescript
	 * {
	 *   'user': 'user-activity',
	 *   'engagement': 'product-usage',
	 *   'error': 'alerts',
	 *   'conversion': 'revenue'
	 * }
	 * ```
	 *
	 * Channel resolution priority:
	 * 1. Event property `__emitkit_channel` (highest priority)
	 * 2. Category mapping via `categoryChannelMap`
	 * 3. Default `channelName` (fallback, default: 'general')
	 */
	categoryChannelMap?: Record<string, string>;

	/**
	 * Send notification for events
	 * @default true
	 */
	notify?: boolean;

	/**
	 * Display style for events
	 * @default 'notification'
	 */
	displayAs?: "message" | "notification";

	/**
	 * Enable debug logging
	 */
	debug?: boolean;

	/**
	 * Enable/disable the provider
	 */
	enabled?: boolean;
}

export class EmitKitServerProvider extends BaseAnalyticsProvider {
	name = "EmitKit-Server";
	private client?: EmitKit;
	private initialized = false;
	private config: EmitKitServerConfig;

	constructor(config: EmitKitServerConfig) {
		super({ debug: config.debug, enabled: config.enabled });
		this.config = config;
	}

	async initialize(): Promise<void> {
		if (!this.isEnabled()) return;
		if (this.initialized) return;

		// Validate config has required fields
		if (!this.config.apiKey || typeof this.config.apiKey !== "string") {
			throw new Error("EmitKit requires an apiKey");
		}

		if (!this.config.apiKey.startsWith("emitkit_")) {
			console.warn(
				"[EmitKit-Server] API key should start with 'emitkit_'. Double check your configuration.",
			);
		}

		try {
			// Dynamically import the EmitKit SDK
			const { EmitKit } = await import("@emitkit/js");

			this.client = new EmitKit(this.config.apiKey, {
				timeout: this.config.timeout ?? DEFAULT_TIMEOUT,
			});

			this.initialized = true;
			this.log("Initialized successfully");
		} catch (error) {
			console.error(
				`[EmitKit-Server] Failed to initialize (${this.getErrorClass(error)})`,
			);
			throw error;
		}
	}

	async identify(
		userId: string,
		traits?: Record<string, unknown>,
	): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		// Extract email from traits; EmitKit rejects non-string aliases.
		const email =
			typeof traits?.email === "string" && traits.email ? traits.email : userId;

		// Build aliases array - EmitKit supports multiple identifiers
		const aliases: string[] = [];

		// Add userId as primary alias
		if (userId) {
			aliases.push(userId);
		}

		// Add email if different from userId
		if (email && email !== userId) {
			aliases.push(email);
		}

		// Add any custom alias fields from traits
		if (traits?.username && typeof traits.username === "string") {
			aliases.push(traits.username);
		}

		try {
			const result = await this.client.identify({
				user_id: userId,
				// EmitKit replaces the stored properties on every identify call, so
				// only send them when the caller supplied traits.
				...(traits && { properties: traits }),
				aliases: aliases.length > 0 ? aliases : undefined,
			});

			this.log("Identified user");

			if (
				result.data.aliases?.failed &&
				result.data.aliases.failed.length > 0
			) {
				console.warn(
					`[EmitKit-Server] ${result.data.aliases.failed.length} aliases failed to create`,
				);
			}
		} catch (error) {
			console.error(
				`[EmitKit-Server] Failed to identify user (${this.describeError(error)})`,
			);
		}
	}

	async track(event: BaseEvent, context?: EventContext): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		// Server providers use only identity supplied on the current call.
		const userId =
			context?.user?.email || context?.user?.userId || event.userId;

		// Generate event title from action (convert snake_case to Title Case)
		const title = this.formatEventTitle(event.action);

		// Build metadata from event properties and context
		// Strip __emitkit_channel from properties as it's internal routing metadata
		const { __emitkit_channel, ...cleanProperties } = event.properties || {};

		const metadata: Record<string, unknown> = {
			...cleanProperties,
			category: event.category,
			timestamp: event.timestamp || Date.now(),
			...(event.sessionId && { sessionId: event.sessionId }),
			...this.getContextMetadata(context),
		};

		// Extract tags from category
		const tags: string[] = [];
		if (event.category) {
			tags.push(event.category);
		}

		// Add any custom tags from properties
		if (
			cleanProperties?.tags &&
			Array.isArray(cleanProperties.tags) &&
			cleanProperties.tags.every((t) => typeof t === "string")
		) {
			tags.push(...(cleanProperties.tags as string[]));
		}

		// Keep tags within EmitKit's limits; the raw `tags` property stays in
		// metadata.
		const validTags = [
			...new Set(tags.filter((tag) => tag.length <= MAX_TAG_LENGTH)),
		].slice(0, MAX_TAGS);

		// Determine channel name using resolution logic
		const channelName = this.resolveChannelName(event);

		try {
			await this.client.events.create({
				channelName,
				title,
				description: this.getEventDescription(event, context),
				icon: this.getEventIcon(event.category),
				tags: validTags.length > 0 ? validTags : undefined,
				metadata,
				userId: userId || null,
				notify: this.config.notify ?? true,
				displayAs: this.config.displayAs || "notification",
				source: EVENT_SOURCE,
			});

			this.log("Tracked event");
		} catch (error) {
			console.error(
				`[EmitKit-Server] Failed to track event (${this.describeError(error)})`,
			);
			throw error;
		}
	}

	async pageView(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		// Page views may only use identity supplied in the current context.
		const userId = context?.user?.email || context?.user?.userId;

		// Strip __emitkit_channel from properties if present
		const { __emitkit_channel, ...cleanProperties } = properties || {};

		// Build page view metadata
		const metadata: Record<string, unknown> = {
			...cleanProperties,
			date: new Date().toISOString(),
			...this.getContextMetadata(context),
		};

		// Create a synthetic event for channel resolution
		// Page views use 'navigation' category
		const syntheticEvent: BaseEvent = {
			action: "page_view",
			category: "navigation",
			properties: properties || {},
		};

		// Determine channel name using resolution logic
		const channelName = this.resolveChannelName(syntheticEvent);

		try {
			await this.client.events.create({
				channelName,
				title: "Page View",
				description: context?.page?.path || "User viewed a page",
				icon: "👁️",
				tags: ["page_view", "navigation"],
				metadata,
				userId: userId || null,
				notify: false, // Don't notify for page views by default
				displayAs: "message",
				source: EVENT_SOURCE,
			});

			this.log("Tracked page view");
		} catch (error) {
			console.error(
				`[EmitKit-Server] Failed to track page view (${this.describeError(error)})`,
			);
		}
	}

	async reset(): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		this.log("Reset called; server provider has no retained identity");
	}

	async shutdown(): Promise<void> {
		// EmitKit SDK doesn't require explicit shutdown
		// Events are sent immediately (not batched)
		this.client = undefined;
		this.initialized = false;
		this.log("Shutdown complete");
	}

	// ============================================================================
	// Helper Methods
	// ============================================================================

	/**
	 * Request context attached to event metadata. EmitKit shows metadata in
	 * team feeds and notifications, so the visitor IP address (which proxy
	 * ingestion adds to `device`) is never forwarded.
	 */
	private getContextMetadata(context?: EventContext): Record<string, unknown> {
		const device = context?.device && withoutIp(context.device);
		const server = context?.server && withoutIp(context.server);

		return {
			...(context?.page && {
				page: {
					url: context.page.url,
					host: context.page.host,
					path: context.page.path,
					title: context.page.title,
					protocol: context.page.protocol,
					referrer: context.page.referrer,
					...(context.page.search && { search: context.page.search }),
				},
			}),
			...(device && Object.keys(device).length > 0 && { device }),
			...(context?.utm && { utm: context.utm }),
			...(server && Object.keys(server).length > 0 && { server }),
		};
	}

	/**
	 * Describe an SDK failure for logs. EmitKit errors add their status code and
	 * request id, which tell auth, validation, and rate-limit failures apart; the
	 * message and response body are never logged.
	 */
	private describeError(error: unknown): string {
		const errorClass = this.getErrorClass(error);
		try {
			if (!(error instanceof Error) || !EMITKIT_ERROR_NAMES.has(error.name)) {
				return errorClass;
			}
			const statusCode = Reflect.get(error, "statusCode");
			const requestId = Reflect.get(error, "requestId");
			return [
				error.name,
				typeof statusCode === "number" ? statusCode : undefined,
				typeof requestId === "string" ? `request ${requestId}` : undefined,
			]
				.filter((part) => part !== undefined)
				.join(" ");
		} catch {
			// Error description must never replace the original failure.
			return errorClass;
		}
	}

	/**
	 * Format event action into a human-readable title
	 * Converts: "user_signed_up" -> "User Signed Up"
	 */
	private formatEventTitle(action: string): string {
		return action
			.split("_")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
	}

	/**
	 * Generate a description for the event
	 */
	private getEventDescription(
		event: BaseEvent,
		context?: EventContext,
	): string | undefined {
		// Use explicit description from properties if available. The full value
		// stays in metadata.
		if (
			event.properties?.description &&
			typeof event.properties.description === "string"
		) {
			return truncate(event.properties.description, MAX_DESCRIPTION_LENGTH);
		}

		// Generate default description based on category
		const categoryDescriptions: Record<string, string> = {
			engagement: "User interaction event",
			user: "User lifecycle event",
			navigation: "Navigation event",
			error: "Error or exception occurred",
			performance: "Performance metric",
			conversion: "Conversion event",
		};

		return categoryDescriptions[event.category] || undefined;
	}

	/**
	 * Get an appropriate icon for the event category
	 */
	private getEventIcon(category: string): string | undefined {
		const categoryIcons: Record<string, string> = {
			engagement: "👆",
			user: "👤",
			navigation: "🧭",
			error: "❌",
			performance: "⚡",
			conversion: "💰",
		};

		return categoryIcons[category];
	}

	/**
	 * Resolve the channel name for an event based on priority:
	 * 1. Event property __emitkit_channel (highest priority)
	 * 2. Category mapping via categoryChannelMap
	 * 3. Default channelName (fallback, default: 'general')
	 */
	private resolveChannelName(
		event: BaseEvent,
		defaultChannel?: string,
	): string {
		// Priority 1: Check for explicit channel override in properties
		if (
			event.properties?.__emitkit_channel &&
			typeof event.properties.__emitkit_channel === "string"
		) {
			return event.properties.__emitkit_channel;
		}

		// Priority 2: Check category mapping
		if (this.config.categoryChannelMap && event.category) {
			const mappedChannel = this.config.categoryChannelMap[event.category];
			if (mappedChannel) {
				return mappedChannel;
			}
		}

		// Priority 3: Use default channel
		return defaultChannel || this.config.channelName || "general";
	}
}

function withoutIp<T extends { ip?: unknown }>(block: T): Omit<T, "ip"> {
	const { ip: _ip, ...rest } = block;
	return rest;
}

/**
 * Cut a string to at most `maxLength` UTF-16 code units without leaving half
 * of a surrogate pair at the end.
 */
function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	const cut = value.slice(0, maxLength);
	const last = cut.charCodeAt(cut.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
