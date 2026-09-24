import {
	BaseAnalyticsProvider,
	type BaseEvent,
	type EventContext,
} from "trakoo";
import {
	buildEventProperties,
	buildIdentifyPayload,
	buildTrackedEventProperties,
} from "./shared.js";
import {
	createDeliveryFailureReporter,
	instrumentOpenPanelDelivery,
} from "./transport.js";
import type { OpenPanelDeliveryFailureHandler } from "./transport.js";
import { isBrowser } from "./environment.js";
import type {
	OpenPanel as OpenPanelWebClient,
	OpenPanelOptions as OpenPanelWebOptions,
} from "@openpanel/web";

export type OpenPanelClientConfig = Omit<
	OpenPanelWebOptions,
	| "clientSecret"
	| "debug"
	| "disabled"
	| "sdk"
	| "sdkVersion"
	| "waitForProfile"
> & {
	clientId: string;
	debug?: boolean;
	enabled?: boolean;
	/**
	 * Called when OpenPanel rejects an event. Without a handler the failure is
	 * logged, because the OpenPanel SDK drops rejected requests silently.
	 */
	onDeliveryFailure?: OpenPanelDeliveryFailureHandler;
};

export type {
	OpenPanelDeliveryFailure,
	OpenPanelDeliveryFailureHandler,
	OpenPanelDeliveryFailureReason,
} from "./transport.js";

export class OpenPanelClientProvider extends BaseAnalyticsProvider {
	name = "OpenPanel-Client";
	private client?: OpenPanelWebClient;
	private trackEvent?: OpenPanelWebClient["track"];
	private config: OpenPanelClientConfig;
	private initialized = false;
	private initPromise?: Promise<void>;
	private pendingActions: Array<() => void> = [];

	constructor(config: OpenPanelClientConfig) {
		super({ debug: config.debug, enabled: config.enabled });
		this.config = config;
	}

	initialize(): Promise<void> {
		if (!this.isEnabled() || this.initialized) return Promise.resolve();
		if (this.initPromise) return this.initPromise;

		this.initPromise = this.doInitialize();
		return this.initPromise;
	}

	private async doInitialize(): Promise<void> {
		if (!isBrowser()) {
			this.log("Skipping initialization - not in browser environment");
			return;
		}

		if (!this.config.clientId || typeof this.config.clientId !== "string") {
			this.initPromise = undefined;
			throw new Error("OpenPanel requires a clientId");
		}

		try {
			const { OpenPanel, OpenPanelBase } = await import("@openpanel/web");
			const runtimeConfig = this.config as OpenPanelClientConfig &
				Partial<
					Pick<
						OpenPanelWebOptions,
						| "clientSecret"
						| "disabled"
						| "sdk"
						| "sdkVersion"
						| "waitForProfile"
					>
				>;
			const {
				enabled,
				clientSecret,
				disabled,
				onDeliveryFailure,
				sdk,
				sdkVersion,
				waitForProfile,
				...options
			} = runtimeConfig;
			void enabled;
			void clientSecret;
			void disabled;
			void sdk;
			void sdkVersion;
			void waitForProfile;

			this.client = new OpenPanel({
				trackAttributes: false,
				trackOutgoingLinks: false,
				trackScreenViews: false,
				...options,
				debug: this.config.debug ?? false,
			});
			const instrumented = instrumentOpenPanelDelivery(
				this.client,
				createDeliveryFailureReporter(this.name, onDeliveryFailure),
			);
			if (!instrumented) {
				this.log("Delivery reporting unavailable - unrecognized transport");
			}
			// The web override replaces a caller-supplied __path with its last screen view.
			this.trackEvent = OpenPanelBase.prototype.track.bind(this.client);
			this.initialized = true;
			this.flushPendingActions();
			this.log("Initialized successfully");
		} catch (error) {
			this.initPromise = undefined;
			this.pendingActions = [];
			console.error(
				`[OpenPanel-Client] Failed to initialize (${this.getErrorClass(error)})`,
			);
			throw error;
		}
	}

	private runWhenInitialized(action: () => void): void {
		if (!this.isEnabled()) return;
		if (this.initialized && this.client) {
			action();
			return;
		}
		if (this.initPromise) {
			this.pendingActions.push(action);
		}
	}

	private flushPendingActions(): void {
		const actions = this.pendingActions;
		this.pendingActions = [];
		for (const action of actions) {
			try {
				action();
			} catch (error) {
				console.error(
					`[OpenPanel-Client] Pending action failed (${this.getErrorClass(error)})`,
				);
			}
		}
	}

	identify(userId: string, traits?: Record<string, unknown>): void {
		this.runWhenInitialized(() => {
			const pending = this.client?.identify(
				buildIdentifyPayload(userId, traits),
			);
			if (pending) {
				void pending.catch((error) => {
					console.error(
						`[OpenPanel-Client] Failed to identify user (${this.getErrorClass(error)})`,
					);
				});
			}
			this.log("Identified user");
		});
	}

	async track(event: BaseEvent, context?: EventContext): Promise<void> {
		if (!this.isEnabled()) return;
		if (!this.initialized && this.initPromise) await this.initPromise;
		if (!this.initialized || !this.trackEvent) return;

		await this.trackEvent(
			event.action,
			buildTrackedEventProperties(event, context),
		);
		this.log("Tracked event");
	}

	pageView(properties?: Record<string, unknown>, context?: EventContext): void {
		this.runWhenInitialized(() => {
			const pageProperties = buildEventProperties(properties, context, {});
			const path = context?.page?.url ?? context?.page?.path;
			if (path) {
				this.client?.screenView(path, pageProperties);
			} else {
				this.client?.screenView(pageProperties);
			}
			this.log("Tracked page view");
		});
	}

	pageLeave(
		_properties?: Record<string, unknown>,
		_context?: EventContext,
	): void {
		this.log("Page leave is not supported by OpenPanel");
	}

	reset(): void {
		this.pendingActions = [];
		if (!this.isEnabled() || !this.initialized || !this.client) return;

		this.client.clear();
		this.log("Cleared user identity");
	}
}
