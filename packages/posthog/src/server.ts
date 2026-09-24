import {
	BaseAnalyticsProvider,
	type BaseEvent,
	type EventContext,
} from "trakoo";
import type { PostHog, PostHogOptions } from "posthog-node";

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

		const { apiKey, ...posthogOptions } = this.config;
		this.client = new PostHogClient(apiKey, {
			host: "https://app.posthog.com",
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

		const properties = {
			...event.properties,
			category: event.category,
			timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
			...(event.sessionId && { sessionId: event.sessionId }),
			...(context?.page && {
				$current_url: context.page.path,
				$page_title: context.page.title,
				$referrer: context.page.referrer,
			}),
			...(context?.device && { device: context.device }),
			...(context?.utm && { utm: context.utm }),
			// Include user email and traits as regular event properties
			...(context?.user?.email && { user_email: context.user.email }),
			...(context?.user?.traits && { user_traits: context.user.traits }),
		};

		this.client.capture({
			distinctId: event.userId || context?.user?.userId || "anonymous",
			event: event.action,
			properties,
		});

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
		const distinctId =
			context?.user?.userId || context?.user?.email || "anonymous";

		this.client.capture({
			distinctId,
			event: "$pageview",
			properties: pageProperties,
		});

		this.log("Tracked page view");
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
