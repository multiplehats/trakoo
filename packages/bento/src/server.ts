import {
	BaseAnalyticsProvider,
	type BaseEvent,
	type EventContext,
	type RevenueDescriptor,
} from "trakoo";
import type { Analytics } from "@bentonow/bento-node-sdk";

// Bento SDK configuration options (matching their internal AnalyticsOptions interface)
export interface BentoAnalyticsOptions {
	/**
	 * Your Bento Site UUID from Team Settings
	 */
	siteUuid: string;
	/**
	 * Authentication credentials
	 */
	authentication: {
		/**
		 * Your Bento Publishable Key from Team Settings
		 */
		publishableKey: string;
		/**
		 * Your Bento Secret Key from Team Settings
		 */
		secretKey: string;
	};
	/**
	 * Optional client configuration
	 */
	clientOptions?: {
		/**
		 * Base URL for the Bento API (optional)
		 */
		baseUrl?: string;
	};
	/**
	 * Whether to log errors (optional)
	 */
	logErrors?: boolean;
}

// Configuration for Bento server provider
export interface BentoServerConfig extends BentoAnalyticsOptions {
	/**
	 * Enable debug logging
	 */
	debug?: boolean;
	/**
	 * Enable/disable the provider
	 */
	enabled?: boolean;
}

export class BentoServerProvider extends BaseAnalyticsProvider {
	name = "Bento-Server";
	private client?: Analytics;
	private initialized = false;
	private config: BentoServerConfig;

	constructor(config: BentoServerConfig) {
		super({ debug: config.debug, enabled: config.enabled });
		this.config = config;
	}

	async initialize(): Promise<void> {
		if (!this.isEnabled()) return;
		if (this.initialized) return;

		// Validate config has required fields
		if (!this.config.siteUuid || typeof this.config.siteUuid !== "string") {
			throw new Error("Bento requires a siteUuid");
		}
		if (
			!this.config.authentication?.publishableKey ||
			typeof this.config.authentication.publishableKey !== "string"
		) {
			throw new Error("Bento requires authentication.publishableKey");
		}
		if (
			!this.config.authentication?.secretKey ||
			typeof this.config.authentication.secretKey !== "string"
		) {
			throw new Error("Bento requires authentication.secretKey");
		}

		try {
			// Dynamically import the Bento SDK
			// This will be resolved at runtime when the package is installed
			const { Analytics } = await import("@bentonow/bento-node-sdk");

			const { debug, enabled, ...bentoConfig } = this.config;
			this.client = new Analytics(bentoConfig);

			this.initialized = true;
			this.log("Initialized successfully");
		} catch (error) {
			this.logFailure("initialize", this.getErrorClass(error));
			throw error;
		}
	}

	async identify(
		userId: string,
		traits?: Record<string, unknown>,
	): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		// Extract email from userId or traits
		const email = (traits?.email as string | undefined) || userId;

		// Validate that we have a proper email format
		if (!email || !email.includes("@")) {
			this.log("Skipping identify - invalid or missing email");
			return;
		}

		// Update the subscriber's fields. Bento creates the subscriber when needed.
		// V1.addSubscriber is not used: it sends $subscribe, which subscribes the
		// person to marketing email and re-runs subscribe automations on every call.
		const { email: _email, ...fields } = traits ?? {};

		try {
			const queued = await this.client.V1.updateFields({ email, fields });
			if (!queued) {
				this.logFailure("identify user", "not queued by Bento");
				return;
			}
			this.log("Identified user");
		} catch (error) {
			this.logFailure("identify user", this.getErrorClass(error));
		}
	}

	async track(event: BaseEvent, context?: EventContext): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		// Server providers use only identity supplied on the current call.
		const email =
			context?.user?.email ||
			(context?.user?.userId as string | undefined) ||
			event.userId;

		// Bento SDK does not currently support anonymous events
		// See: https://github.com/bentonow/bento-node-sdk
		if (!email || !email.includes("@")) {
			console.warn(
				"[Bento-Server] Skipping event - Bento requires an email address. " +
					"Anonymous events are not currently supported by the Bento Node SDK. " +
					"For now, use the Bento client provider for anonymous tracking. " +
					"If you're using a proxy, use the hybrid pattern as described in the docs. " +
					"For identified events, provide a valid email in the current call's user context or event userId; calling identify() earlier does not set event identity.",
			);
			return;
		}

		const details = {
			...event.properties,
			category: event.category,
			timestamp: event.timestamp || Date.now(),
			...(event.sessionId && { sessionId: event.sessionId }),
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
			...(context?.device && { device: context.device }),
			...(context?.utm && { utm: context.utm }),
			site: this.config.siteUuid,
			...(context?.user?.userId && { visitor: context.user.userId }),
		};

		// Add user traits as fields if available
		const fields = context?.user?.traits || {};

		try {
			const queued = await this.client.V1.track({
				email,
				type: `$${event.action}`,
				details,
				fields,
				...(event.timestamp !== undefined && {
					date: new Date(event.timestamp),
				}),
			});
			if (!queued) {
				this.logFailure("track event", "not queued by Bento");
				return;
			}

			this.log("Tracked event");
		} catch (error) {
			this.logFailure("track event", this.getErrorClass(error));
		}
	}

	/**
	 * Sends Bento's `$purchase`, which adds to the subscriber's lifetime value.
	 * Bento needs the subscriber's email (from this call's user context, or a
	 * `userId` that is one), a currency, and an `id` it deduplicates the
	 * purchase by; without all three the revenue is skipped with a warning.
	 *
	 * @remarks Bento runs `$purchase` automations on it.
	 */
	async revenue(
		revenue: RevenueDescriptor,
		context?: EventContext,
	): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		const email =
			context?.user?.email ||
			(context?.user?.userId as string | undefined) ||
			revenue.userId;
		const { currency, id } = revenue;
		if (!email?.includes("@") || currency === undefined || id === undefined) {
			const missing = [
				...(!email?.includes("@") ? ["an email address"] : []),
				...(currency === undefined ? ["a currency"] : []),
				...(id === undefined ? ["an id"] : []),
			];
			console.warn(
				`[Bento-Server] Skipping revenue - a Bento purchase requires ${missing.join(" and ")}.`,
			);
			return;
		}

		try {
			const queued = await this.client.V1.trackPurchase({
				email,
				date: new Date(revenue.timestamp),
				purchaseDetails: {
					unique: { key: id },
					value: { currency, amount: revenue.amount },
				},
			});
			if (!queued) {
				this.logFailure("track purchase", "not queued by Bento");
				return;
			}
			this.log("Tracked purchase");
		} catch (error) {
			this.logFailure("track purchase", this.getErrorClass(error));
		}
	}

	async pageView(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		// Page views may only use identity supplied in the current context.
		const email =
			context?.user?.email || (context?.user?.userId as string | undefined);

		// Bento SDK does not currently support anonymous events
		// See: https://github.com/bentonow/bento-node-sdk
		if (!email || !email.includes("@")) {
			console.warn(
				"[Bento-Server] Skipping pageView - Bento requires an email address. " +
					"Anonymous events are not currently supported by the Bento Node SDK. " +
					"For now, use the Bento client provider for anonymous tracking. " +
					"If you're using a proxy, use the hybrid pattern as described in the docs. " +
					"For identified page views, provide a valid email in the current call's user context; calling identify() earlier does not set page identity.",
			);
			return;
		}

		const details = {
			...properties,
			date: new Date().toISOString(),
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
			site: this.config.siteUuid,
			...(context?.user?.userId && { visitor: context.user.userId }),
		};

		const fields = context?.user?.traits || {};

		try {
			const queued = await this.client.V1.track({
				email,
				type: "$view",
				details,
				fields,
			});
			if (!queued) {
				this.logFailure("track page view", "not queued by Bento");
				return;
			}
			this.log("Tracked page view");
		} catch (error) {
			this.logFailure("track page view", this.getErrorClass(error));
		}
	}

	async reset(): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		this.log("Reset called; server provider has no retained identity");
	}

	async shutdown(): Promise<void> {
		// Bento Node SDK doesn't require explicit shutdown
		// Just clear the reference
		this.client = undefined;
		this.initialized = false;
		this.log("Shutdown complete");
	}

	/** Logs a failed call without the event, its user, or the SDK's message. */
	private logFailure(action: string, reason: string): void {
		console.error(`[${this.name}] Failed to ${action} (${reason})`);
	}
}
