import {
	BaseAnalyticsProvider,
	type BaseEvent,
	type EventContext,
} from "trakoo";
import type { PostHog, PostHogConfig, Properties } from "posthog-js";
import { isBrowser } from "./environment.js";

export type PostHogClientConfig = Partial<PostHogConfig> & {
	token: string;
	instanceName?: string;
	debug?: boolean;
	enabled?: boolean;
};

let posthogProviderSequence = 0;
const nextInstanceName = () => `trakoo_${++posthogProviderSequence}`;

export class PostHogClientProvider extends BaseAnalyticsProvider {
	name = "PostHog-Client";
	private posthog?: PostHog;
	private initialized = false;
	private initializePromise?: Promise<void>;
	private readonly config: PostHogClientConfig;
	private readonly instanceName: string;

	constructor(config: PostHogClientConfig) {
		super({ debug: config.debug, enabled: config.enabled });
		this.config = config;
		this.instanceName = config.instanceName ?? nextInstanceName();
	}

	initialize(): Promise<void> {
		if (!this.isEnabled() || this.initialized) return Promise.resolve();
		if (this.initializePromise) return this.initializePromise;

		// Check if we're in a browser environment
		if (!isBrowser()) {
			this.log("Skipping initialization - not in browser environment");
			return Promise.resolve();
		}

		this.initializePromise = this.initializePostHog().catch((error) => {
			this.initializePromise = undefined;
			console.error(
				`[PostHog-Client] Failed to initialize (${this.getErrorClass(error)})`,
			);
			throw error;
		});
		return this.initializePromise;
	}

	private async initializePostHog(): Promise<void> {
		// Validate config has required fields
		if (!this.config.token || typeof this.config.token !== "string") {
			throw new Error("PostHog requires a token");
		}

		// Dynamically import PostHog to avoid SSR issues
		const { default: posthog } = await import("posthog-js");

		const {
			token,
			instanceName: _instanceName,
			enabled: _enabled,
			debug: configDebug,
			...posthogConfig
		} = this.config;

		this.posthog = posthog.init(
			token,
			{
				...posthogConfig,
				debug: configDebug ?? this.debug,
			},
			this.instanceName,
		);
		this.initialized = true;

		this.log("Initialized successfully");
	}

	identify(userId: string, traits?: Record<string, unknown>): void {
		if (!this.isEnabled() || !this.initialized || !this.posthog) return;

		this.posthog.identify(userId, traits);
		this.log("Identified user");
	}

	track(event: BaseEvent, context?: EventContext): void {
		if (!this.isEnabled() || !this.initialized || !this.posthog) return;

		// `$current_url` is left to posthog-js, which reads the live location on
		// every capture. The page context is only refreshed by pageView, and a
		// caller's property would override the SDK's full URL.
		//
		// The time stays a property: posthog-js sends any capture that has an
		// options argument, such as `timestamp`, outside its batch queue.
		const properties = {
			...event.properties,
			category: event.category,
			timestamp: event.timestamp || Date.now(),
			...(event.userId && { userId: event.userId }),
			...(event.sessionId && { sessionId: event.sessionId }),
			...(context?.device && { device: context.device }),
			...(context?.utm && { utm: context.utm }),
			// Include user email and traits as regular event properties
			...(context?.user?.email && { user_email: context.user.email }),
			...(context?.user?.traits && { user_traits: context.user.traits }),
		};

		this.posthog.capture(event.action, properties);
		this.log("Tracked event");
	}

	pageView(properties?: Record<string, unknown>, context?: EventContext): void {
		if (!this.isEnabled() || !this.initialized || !this.posthog || !isBrowser())
			return;

		const pageProperties = {
			...properties,
			...(context?.page && {
				path: context.page.path,
				title: context.page.title,
				referrer: context.page.referrer,
			}),
		} satisfies Properties;

		this.posthog.capture("$pageview", pageProperties);
		this.log("Tracked page view");
	}

	pageLeave(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): void {
		if (!this.isEnabled() || !this.initialized || !this.posthog || !isBrowser())
			return;

		const pageLeaveProperties = {
			...properties,
			...(context?.page && {
				path: context.page.path,
				title: context.page.title,
				referrer: context.page.referrer,
			}),
		} satisfies Properties;

		this.posthog.capture("$pageleave", pageLeaveProperties);
		this.log("Tracked page leave");
	}

	reset(): void {
		if (!this.isEnabled() || !this.initialized || !this.posthog || !isBrowser())
			return;

		this.posthog.reset();
		this.log("Reset user session");
	}
}

export type { PostHogConfig } from "posthog-js";
