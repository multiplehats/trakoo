import type { BaseEvent, EventContext } from "@/core/events/types.js";
import { BaseAnalyticsProvider } from "@/providers/base.provider.js";
import {
	buildEventProperties,
	buildIdentifyPayload,
	buildTrackedEventProperties,
	withRequestContext,
} from "@/providers/openpanel/shared.js";
import {
	createDeliveryFailureReporter,
	instrumentOpenPanelDelivery,
} from "@/providers/openpanel/transport.js";
import type { OpenPanelDeliveryFailureHandler } from "@/providers/openpanel/transport.js";
import type { OpenPanel, OpenPanelOptions } from "@openpanel/sdk";

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

export interface OpenPanelServerConfig {
	clientId: string;
	clientSecret: string;
	apiUrl?: string;
	filter?: OpenPanelOptions["filter"];
	debug?: boolean;
	enabled?: boolean;
	/**
	 * Called when OpenPanel rejects an event. Without a handler the failure is
	 * logged, because the OpenPanel SDK drops rejected requests silently.
	 */
	onDeliveryFailure?: OpenPanelDeliveryFailureHandler;
}

export type {
	OpenPanelDeliveryFailure,
	OpenPanelDeliveryFailureHandler,
	OpenPanelDeliveryFailureReason,
} from "@/providers/openpanel/transport.js";

export class OpenPanelServerProvider extends BaseAnalyticsProvider {
	name = "OpenPanel-Server";
	private client?: OpenPanel;
	private config: OpenPanelServerConfig;
	private initialized = false;
	private initializePromise?: Promise<void>;

	constructor(config: OpenPanelServerConfig) {
		super({ debug: config.debug, enabled: config.enabled });
		this.config = config;
	}

	initialize(): Promise<void> {
		if (!this.isEnabled() || this.initialized) return Promise.resolve();
		if (this.initializePromise) return this.initializePromise;

		this.initializePromise = this.initializeOpenPanel().catch((error) => {
			this.initializePromise = undefined;
			console.error(
				`[OpenPanel-Server] Failed to initialize (${this.getErrorClass(error)})`,
			);
			throw error;
		});
		return this.initializePromise;
	}

	private async initializeOpenPanel(): Promise<void> {
		if (!this.config.clientId || typeof this.config.clientId !== "string") {
			throw new Error("OpenPanel requires a clientId");
		}
		if (
			!this.config.clientSecret ||
			typeof this.config.clientSecret !== "string"
		) {
			throw new Error("OpenPanel requires a clientSecret on the server");
		}

		let OpenPanelClient: typeof import("@openpanel/sdk").OpenPanel;
		try {
			({ OpenPanel: OpenPanelClient } = await import("@openpanel/sdk"));
		} catch (error) {
			if (isMissingPackageError(error, "@openpanel/sdk")) {
				throw new Error(
					"OpenPanel server provider requires the optional peer package @openpanel/sdk",
				);
			}
			throw error;
		}

		const { enabled, onDeliveryFailure, ...options } = this.config;
		void enabled;

		this.client = new OpenPanelClient(options);
		this.reportDeliveryFailures(onDeliveryFailure);
		this.initialized = true;
		this.log("Initialized successfully");
	}

	private reportDeliveryFailures(
		onDeliveryFailure: OpenPanelDeliveryFailureHandler | undefined,
	): void {
		const instrumented = instrumentOpenPanelDelivery(
			this.client,
			createDeliveryFailureReporter(this.name, onDeliveryFailure),
		);
		if (!instrumented) {
			this.log("Delivery reporting unavailable - unrecognized transport");
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
		this.log("Updated user profile");
	}

	async track(event: BaseEvent, context?: EventContext): Promise<void> {
		const client =
			this.isEnabled() && this.initialized ? this.client : undefined;
		if (!client) return;

		await client.track(
			event.action,
			withRequestContext(buildTrackedEventProperties(event, context), context),
		);
		this.log("Tracked event");
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
			withRequestContext(
				buildEventProperties(properties, context, {
					category: "navigation",
					userId: context?.user?.userId,
				}),
				context,
			),
		);
		this.log("Tracked page view");
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
		this.initializePromise = undefined;
		this.log("Shutdown complete");
	}
}
