import {
	BaseAnalyticsProvider,
	type BaseEvent,
	type EventContext,
} from "trakoo";
import type { EventMessage, PostHog, PostHogOptions } from "posthog-node";

const firstString = (...values: unknown[]): string | undefined => {
	for (const value of values) {
		if (typeof value === "string" && value) return value;
	}
	return undefined;
};

/**
 * The `device` context without its IP. The address travels as `$ip`, where
 * PostHog's project setting to discard client IP data applies; a copy nested
 * in `device` would escape that setting.
 */
const deviceWithoutIp = (
	device: EventContext["device"],
): Omit<NonNullable<EventContext["device"]>, "ip"> | undefined => {
	if (!device) return undefined;
	const { ip: _ip, ...rest } = device;
	return Object.keys(rest).length > 0 ? rest : undefined;
};

/**
 * The context PostHog reads from its own standard properties: the page URL,
 * and the campaign fields PostHog attributes traffic by.
 */
const standardProperties = (
	context: EventContext | undefined,
): Record<string, string> => {
	const currentUrl = firstString(context?.page?.url, context?.page?.path);
	const utm = context?.utm;
	return {
		...(currentUrl && { $current_url: currentUrl }),
		...(utm?.source && { utm_source: utm.source }),
		...(utm?.medium && { utm_medium: utm.medium }),
		...(utm?.name && { utm_campaign: utm.name }),
	};
};

const isMissingPackageError = (
	error: unknown,
	packageName: string,
): boolean => {
	try {
		if (!error || typeof error !== "object") return false;
		const code = Reflect.get(error, "code");
		const message = Reflect.get(error, "message");
		if (
			(code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") ||
			typeof message !== "string"
		) {
			return false;
		}
		return (
			message.includes(`Cannot find package '${packageName}'`) ||
			message.includes(`Cannot find module '${packageName}'`)
		);
	} catch {
		return false;
	}
};

export class PostHogServerProvider extends BaseAnalyticsProvider {
	name = "PostHog-Server";
	private client?: PostHog;
	private initialized = false;
	private initializePromise?: Promise<void>;
	private config: { apiKey: string } & PostHogOptions;

	constructor(
		config: { apiKey: string } & PostHogOptions & {
				debug?: boolean;
				enabled?: boolean;
			},
	) {
		super({ debug: config.debug, enabled: config.enabled });
		this.config = config;
	}

	initialize(): Promise<void> {
		if (!this.isEnabled() || this.initialized) return Promise.resolve();
		if (this.initializePromise) return this.initializePromise;

		this.initializePromise = this.initializePostHog().catch((error) => {
			this.initializePromise = undefined;
			console.error(
				`[PostHog-Server] Failed to initialize (${this.getErrorClass(error)})`,
			);
			throw error;
		});
		return this.initializePromise;
	}

	private async initializePostHog(): Promise<void> {
		// Validate config has required fields
		if (!this.config.apiKey || typeof this.config.apiKey !== "string") {
			throw new Error("PostHog requires an apiKey");
		}

		let PostHogClient: typeof import("posthog-node").PostHog;
		try {
			({ PostHog: PostHogClient } = await import("posthog-node"));
		} catch (error) {
			if (isMissingPackageError(error, "posthog-node")) {
				throw new Error(
					"PostHog server provider requires the optional peer package posthog-node",
				);
			}
			throw error;
		}

		// The host is left to the SDK, whose default is PostHog's US ingestion
		// host rather than the legacy app.posthog.com.
		const { apiKey, ...posthogOptions } = this.config;
		this.client = new PostHogClient(apiKey, {
			flushAt: 20,
			flushInterval: 10000,
			...posthogOptions,
		});

		this.initialized = true;
		this.log("Initialized successfully");
	}

	identify(userId: string, traits?: Record<string, unknown>): void {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		this.client.identify({
			distinctId: userId,
			properties: traits,
		});

		this.log("Identified user");
	}

	track(event: BaseEvent, context?: EventContext): void {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		const device = deviceWithoutIp(context?.device);
		const properties = {
			...event.properties,
			category: event.category,
			...(event.sessionId && { sessionId: event.sessionId }),
			...(context?.page && {
				$page_title: context.page.title,
				$referrer: context.page.referrer,
			}),
			...(device && { device }),
			...(context?.utm && { utm: context.utm }),
			// Include user email and traits as regular event properties
			...(context?.user?.email && { user_email: context.user.email }),
			...(context?.user?.traits && { user_traits: context.user.traits }),
		};

		this.client.capture(
			this.buildEventMessage({
				event: event.action,
				distinctId: event.userId || context?.user?.userId,
				properties,
				context,
				timestamp: event.timestamp,
			}),
		);

		this.log("Tracked event");
	}

	pageView(properties?: Record<string, unknown>, context?: EventContext): void {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		const pageProperties = {
			...properties,
			...(context?.page && {
				path: context.page.path,
				title: context.page.title,
				referrer: context.page.referrer,
			}),
		};

		this.client.capture(
			this.buildEventMessage({
				event: "$pageview",
				distinctId: context?.user?.userId || context?.user?.email,
				properties: pageProperties,
				context,
			}),
		);

		this.log("Tracked page view");
	}

	/**
	 * Adds what PostHog reads from its own fields and properties: the event
	 * time, the visitor's IP and user agent, and the page and campaign. Identity
	 * comes from this call alone, because one server provider serves many users.
	 */
	private buildEventMessage({
		event,
		distinctId,
		properties,
		context,
		timestamp,
	}: {
		event: string;
		distinctId: string | undefined;
		properties: Record<string, unknown>;
		context: EventContext | undefined;
		timestamp?: number;
	}): EventMessage {
		const ip = firstString(context?.server?.ip, context?.device?.ip);
		const userAgent = firstString(
			context?.server?.userAgent,
			context?.device?.userAgent,
		);

		return {
			// An event without a user gets a distinct ID of its own and no person
			// profile, as PostHog recommends. A shared placeholder ID would merge
			// every anonymous visitor into one person.
			distinctId: distinctId || crypto.randomUUID(),
			event,
			properties: {
				...properties,
				...standardProperties(context),
				...(ip && { $ip: ip }),
				...(userAgent && { $raw_user_agent: userAgent }),
				...(!distinctId && { $process_person_profile: false }),
			},
			...(timestamp !== undefined && { timestamp: new Date(timestamp) }),
			// posthog-node disables GeoIP by default because it would locate the
			// server. A forwarded visitor IP is the one to locate, unless the app
			// configured `disableGeoip` itself.
			...(ip &&
				this.config.disableGeoip === undefined && { disableGeoip: false }),
		};
	}

	async reset(): Promise<void> {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		// Flush any pending events
		await this.client.flush();
		this.log("Flushed pending events");
	}

	async shutdown(): Promise<void> {
		if (this.client) {
			await this.client.shutdown();
			this.log("Shutdown complete");
		}
	}
}

export type { PostHogOptions } from "posthog-node";
