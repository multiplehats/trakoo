import type { BaseEvent, EventContext } from "@/core/events/types.js";
import { BaseAnalyticsProvider } from "@/providers/base.provider.js";

type Protocol = "http" | "https";
type Scalar = string | number | boolean;

/**
 * Pirsch Hit structure for page views and events
 */
interface PirschHit {
	url: string;
	ip: string;
	user_agent: string;
	accept_language?: string;
	sec_ch_ua?: string;
	sec_ch_ua_mobile?: string;
	sec_ch_ua_platform?: string;
	sec_ch_ua_platform_version?: string;
	sec_ch_width?: string;
	sec_ch_viewport_width?: string;
	title?: string;
	referrer?: string;
	screen_width?: number;
	screen_height?: number;
	tags?: Record<string, Scalar>;
	disable_bot_filter?: boolean;
}

/**
 * Pirsch Event structure
 */
interface PirschEvent extends PirschHit {
	event_name: string;
	event_duration?: number;
	event_meta?: Record<string, string>;
	non_interactive?: boolean;
}

// Pirsch server configuration options
export interface PirschServerConfig {
	/**
	 * The hostname/domain being tracked (required)
	 * Example: "example.com"
	 */
	hostname: string;
	/**
	 * Protocol to use (default: "https")
	 */
	protocol?: Protocol;
	/**
	 * Client ID for OAuth authentication
	 * Required if not using access key
	 */
	clientId?: string;
	/**
	 * Client secret or access key for authentication
	 * Access keys start with "pa_"
	 */
	clientSecret: string;
	/**
	 * Request timeout in milliseconds
	 * @default 10000
	 */
	timeout?: number;
	/**
	 * Enable debug logging
	 */
	debug?: boolean;
	/**
	 * Enable/disable the provider
	 */
	enabled?: boolean;
	/**
	 * Disable Pirsch's bot filter
	 * Useful for controlled environments where you want to track all requests
	 */
	disableBotFilter?: boolean;
}

const PIRSCH_API_BASE = "https://api.pirsch.io";
const DEFAULT_TIMEOUT = 10000;

export class PirschServerProvider extends BaseAnalyticsProvider {
	name = "Pirsch-Server";
	private initialized = false;
	private config: PirschServerConfig;
	private accessToken = "";
	private tokenExpiresAt: Date | null = null;
	private isAccessKey = false;

	constructor(config: PirschServerConfig) {
		super({ debug: config.debug, enabled: config.enabled });
		this.config = config;
	}

	async initialize(): Promise<void> {
		if (!this.isEnabled()) return;
		if (this.initialized) return;

		// Validate config has required fields
		if (!this.config.hostname || typeof this.config.hostname !== "string") {
			throw new Error("Pirsch requires a hostname");
		}
		if (
			!this.config.clientSecret ||
			typeof this.config.clientSecret !== "string"
		) {
			throw new Error("Pirsch requires a clientSecret (or access key)");
		}

		// Check if using access key (starts with "pa_") or OAuth (requires clientId)
		this.isAccessKey = this.config.clientSecret.startsWith("pa_");
		if (!this.isAccessKey && !this.config.clientId) {
			throw new Error(
				"Pirsch requires a clientId when using OAuth authentication (clientSecret doesn't start with 'pa_'). " +
					"Either provide a clientId or use an access key (starts with 'pa_') as clientSecret.",
			);
		}

		// For access keys, use directly as the token
		if (this.isAccessKey) {
			this.accessToken = this.config.clientSecret;
		}

		this.initialized = true;
		this.log("Initialized successfully");
	}

	/**
	 * Fetch with timeout using AbortController
	 */
	private async fetchWithTimeout(
		url: string,
		options: RequestInit,
		timeout?: number,
	): Promise<Response> {
		const controller = new AbortController();
		const timeoutMs = timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT;
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});
			return response;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Ensure we have a valid access token (for OAuth mode)
	 */
	private async ensureToken(): Promise<string> {
		// Access keys don't need token refresh
		if (this.isAccessKey) {
			return this.accessToken;
		}

		// Check if current token is still valid (with 1 minute buffer)
		if (
			this.accessToken &&
			this.tokenExpiresAt &&
			new Date() < new Date(this.tokenExpiresAt.getTime() - 60000)
		) {
			return this.accessToken;
		}

		// Fetch new token
		try {
			const response = await this.fetchWithTimeout(
				`${PIRSCH_API_BASE}/api/v1/token`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						client_id: this.config.clientId,
						client_secret: this.config.clientSecret,
					}),
				},
			);

			if (!response.ok) {
				const error = await response.text();
				throw new Error(
					`Failed to get Pirsch token: ${response.status} ${error}`,
				);
			}

			const data = await response.json();
			this.accessToken = data.access_token;
			this.tokenExpiresAt = new Date(data.expires_at);

			this.log("OAuth token refreshed");
			return this.accessToken;
		} catch (error) {
			console.error(
				`[Pirsch-Server] Failed to refresh token (${this.getErrorClass(error)})`,
			);
			throw error;
		}
	}

	/**
	 * Make an authenticated request to Pirsch API
	 */
	private async request(
		endpoint: string,
		body: unknown,
		retry = true,
	): Promise<void> {
		const token = await this.ensureToken();

		try {
			const response = await this.fetchWithTimeout(
				`${PIRSCH_API_BASE}${endpoint}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(body),
				},
			);

			// Handle 401 - token expired, refresh and retry once
			if (response.status === 401 && retry && !this.isAccessKey) {
				this.accessToken = "";
				this.tokenExpiresAt = null;
				return this.request(endpoint, body, false);
			}

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`Pirsch API error: ${response.status} ${error}`);
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(
					`Pirsch request timeout after ${this.config.timeout ?? DEFAULT_TIMEOUT}ms`,
				);
			}
			throw error;
		}
	}

	/**
	 * Filter object to only include scalar values (string, number, boolean)
	 */
	private filterScalars(obj: Record<string, unknown>): Record<string, Scalar> {
		return Object.fromEntries(
			Object.entries(obj).filter(
				([, v]) =>
					typeof v === "string" ||
					typeof v === "number" ||
					typeof v === "boolean",
			),
		) as Record<string, Scalar>;
	}

	/**
	 * Convert object values to strings for Pirsch event_meta
	 * Pirsch API requires event_meta to be a single dimension object of string values
	 */
	private toStringRecord(obj: Record<string, unknown>): Record<string, string> {
		return Object.fromEntries(
			Object.entries(obj)
				.filter(
					([, v]) => v !== null && v !== undefined && typeof v !== "object",
				)
				.map(([k, v]) => [k, String(v)]),
		);
	}

	/**
	 * Build a Pirsch hit from context
	 */
	private buildHit(context?: EventContext): PirschHit | null {
		// Extract IP and user-agent from enriched context
		// biome-ignore lint/suspicious/noExplicitAny: Extended context fields from proxy handler
		const extendedContext = context as any;
		const ip = extendedContext?.device?.ip || extendedContext?.server?.ip;
		const userAgent =
			extendedContext?.server?.userAgent || extendedContext?.device?.userAgent;

		// Skip if missing required fields
		if (!ip || !userAgent) {
			return null;
		}

		// Build full URL - always fall back to hostname
		const url =
			context?.page?.url ||
			(context?.page?.protocol && context?.page?.host && context?.page?.path
				? `${context.page.protocol}://${context.page.host}${context.page.path}`
				: context?.page?.path
					? `https://${this.config.hostname}${context.page.path}`
					: `https://${this.config.hostname}`);

		return {
			url,
			ip,
			user_agent: userAgent,
			...(context?.page?.title && { title: context.page.title }),
			...(context?.page?.referrer && { referrer: context.page.referrer }),
			...(context?.device?.screen?.width && {
				screen_width: context.device.screen.width,
			}),
			...(context?.device?.screen?.height && {
				screen_height: context.device.screen.height,
			}),
			...(context?.device?.viewport?.width && {
				sec_ch_viewport_width: String(context.device.viewport.width),
			}),
			...(context?.device?.language && {
				accept_language: context.device.language,
			}),
			...(context?.device?.type && {
				sec_ch_ua_mobile:
					context.device.type === "mobile" || context.device.type === "tablet"
						? "?1"
						: "?0",
			}),
			...(context?.device?.os && { sec_ch_ua_platform: context.device.os }),
			...(this.config.disableBotFilter && { disable_bot_filter: true }),
		};
	}

	async identify(
		userId: string,
		traits?: Record<string, unknown>,
	): Promise<void> {
		if (!this.isEnabled() || !this.initialized) return;

		// Pirsch doesn't have a native identify method
		// Track as a synthetic identification event
		// Note: Uses placeholder IP/user-agent since base interface doesn't support context
		const hit: PirschHit = {
			url: `https://${this.config.hostname}/identify`,
			ip: "0.0.0.0",
			user_agent: "trakoo",
			...(this.config.disableBotFilter && { disable_bot_filter: true }),
		};

		// Pirsch API requires event_meta to be string values only
		const meta = this.toStringRecord({
			userId,
			...traits,
		});

		const event: PirschEvent = {
			...hit,
			event_name: "user_identified",
			event_duration: 0,
			event_meta: meta,
			non_interactive: true, // Synthetic event shouldn't affect bounce rate
		};

		try {
			await this.request("/api/v1/event", event);
			this.log("Identified user via event");
		} catch (error) {
			console.error(
				`[Pirsch-Server] Failed to track identify event (${this.getErrorClass(error)})`,
			);
		}
	}

	async track(event: BaseEvent, context?: EventContext): Promise<void> {
		if (!this.isEnabled() || !this.initialized) return;

		const hit = this.buildHit(context);
		if (!hit) {
			this.log("Skipping event - missing required IP or user-agent");
			return;
		}

		// Build event_meta - Pirsch API requires all values to be strings
		const meta = this.toStringRecord({
			...event.properties,
			category: event.category,
			timestamp: event.timestamp || Date.now(),
			...(event.userId && { userId: event.userId }),
			...(event.sessionId && { sessionId: event.sessionId }),
			...(context?.user?.email && { user_email: context.user.email }),
			...(context?.device?.timezone && { timezone: context.device.timezone }),
			...(context?.device?.browser && { browser: context.device.browser }),
		});

		// Check for non_interactive flag in event properties
		const nonInteractive = event.properties?.non_interactive === true;

		const pirschEvent: PirschEvent = {
			...hit,
			event_name: event.action,
			event_duration: 0,
			event_meta: meta,
			...(nonInteractive && { non_interactive: true }),
		};

		try {
			await this.request("/api/v1/event", pirschEvent);
			this.log("Tracked event");
		} catch (error) {
			console.error(
				`[Pirsch-Server] Failed to track event (${this.getErrorClass(error)})`,
			);
		}
	}

	async pageView(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> {
		if (!this.isEnabled() || !this.initialized) return;

		const hit = this.buildHit(context);
		if (!hit) {
			this.log("Skipping pageView - missing required IP or user-agent");
			return;
		}

		// Add properties as tags (tags support scalar values)
		if (properties && Object.keys(properties).length > 0) {
			hit.tags = this.filterScalars(properties);
		}

		try {
			await this.request("/api/v1/hit", hit);
			this.log("Tracked page view");
		} catch (error) {
			console.error(
				`[Pirsch-Server] Failed to track page view (${this.getErrorClass(error)})`,
			);
		}
	}

	async reset(): Promise<void> {
		if (!this.isEnabled() || !this.initialized) return;

		// Track as a synthetic session reset event
		// Note: Uses placeholder IP/user-agent since base interface doesn't support context
		const hit: PirschHit = {
			url: `https://${this.config.hostname}/session-reset`,
			ip: "0.0.0.0",
			user_agent: "trakoo",
			...(this.config.disableBotFilter && { disable_bot_filter: true }),
		};

		const event: PirschEvent = {
			...hit,
			event_name: "session_reset",
			event_duration: 0,
			event_meta: {},
			non_interactive: true, // Synthetic event shouldn't affect bounce rate
		};

		await this.request("/api/v1/event", event).catch((error) => {
			console.error(
				`[Pirsch-Server] Failed to track session reset (${this.getErrorClass(error)})`,
			);
		});

		this.log("Reset user session");
	}

	async shutdown(): Promise<void> {
		this.accessToken = "";
		this.tokenExpiresAt = null;
		this.initialized = false;
		this.log("Shutdown complete");
	}
}
