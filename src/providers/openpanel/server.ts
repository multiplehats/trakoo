import type { BaseEvent, EventContext } from "@/core/events/types.js";
import { BaseAnalyticsProvider } from "@/providers/base.provider.js";
import {
	buildEventProperties,
	buildIdentifyPayload,
	buildTrackedEventProperties,
} from "@/providers/openpanel/shared.js";
import { OpenPanel, type OpenPanelOptions } from "@openpanel/sdk";

export interface OpenPanelServerConfig {
	clientId: string;
	clientSecret: string;
	apiUrl?: string;
	filter?: OpenPanelOptions["filter"];
	debug?: boolean;
	enabled?: boolean;
}

export class OpenPanelServerProvider extends BaseAnalyticsProvider {
	name = "OpenPanel-Server";
	private client?: OpenPanel;
	private config: OpenPanelServerConfig;
	private initialized = false;

	constructor(config: OpenPanelServerConfig) {
		super({ debug: config.debug, enabled: config.enabled });
		this.config = config;
	}

	initialize(): void {
		if (!this.isEnabled() || this.initialized) return;
		if (!this.config.clientId || typeof this.config.clientId !== "string") {
			throw new Error("OpenPanel requires a clientId");
		}
		if (
			!this.config.clientSecret ||
			typeof this.config.clientSecret !== "string"
		) {
			throw new Error("OpenPanel requires a clientSecret on the server");
		}

		try {
			const { enabled, ...options } = this.config;
			void enabled;

			this.client = new OpenPanel(options);
			this.initialized = true;
			this.log("Initialized successfully");
		} catch (error) {
			console.error("[OpenPanel-Server] Failed to initialize:", error);
			throw error;
		}
	}

	async identify(
		userId: string,
		traits?: Record<string, unknown>,
	): Promise<void> {
		const client =
			this.isEnabled() && this.initialized ? this.client : undefined;
		if (!client) return;

		let pending: ReturnType<OpenPanel["identify"]>;
		try {
			pending = client.identify(buildIdentifyPayload(userId, traits));
		} finally {
			client.clear();
		}
		await pending;
		this.log("Updated user profile", { userId, traits });
	}

	async track(event: BaseEvent, context?: EventContext): Promise<void> {
		const client =
			this.isEnabled() && this.initialized ? this.client : undefined;
		if (!client) return;

		await client.track(
			event.action,
			buildTrackedEventProperties(event, context),
		);
		this.log("Tracked event", { event, context });
	}

	async pageView(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> {
		const client =
			this.isEnabled() && this.initialized ? this.client : undefined;
		if (!client) return;

		await client.track(
			"screen_view",
			buildEventProperties(properties, context, {
				category: "navigation",
				userId: context?.user?.userId,
			}),
		);
		this.log("Tracked page view", { properties, context });
	}

	pageLeave(
		_properties?: Record<string, unknown>,
		_context?: EventContext,
	): void {
		this.log("Page leave is not supported by OpenPanel");
	}

	reset(): void {
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		this.client.clear();
		this.log("Cleared user identity");
	}

	shutdown(): void {
		const client =
			this.isEnabled() && this.initialized ? this.client : undefined;
		if (!client) return;

		client.clear();
		this.client = undefined;
		this.initialized = false;
		this.log("Shutdown complete");
	}
}
