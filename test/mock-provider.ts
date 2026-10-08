import { BaseAnalyticsProvider } from "@/providers/base.provider";
import type {
	BaseEvent,
	EventContext,
	GroupDescriptor,
	RevenueDescriptor,
} from "@/core/events/types";

export class MockAnalyticsProvider extends BaseAnalyticsProvider {
	name = "MockProvider";
	private initialized = false;

	// Track all method calls for testing
	public calls: {
		initialize: number;
		identify: Array<{
			userId: string;
			traits?: Record<string, unknown>;
			context?: EventContext;
		}>;
		track: Array<{ event: BaseEvent; context?: EventContext }>;
		pageView: Array<{
			properties?: Record<string, unknown>;
			context?: EventContext;
		}>;
		pageLeave: Array<{
			properties?: Record<string, unknown>;
			context?: EventContext;
		}>;
		reset: number;
		flush: Array<{ useBeacon?: boolean }>;
		group: Array<{ group: GroupDescriptor; userId?: string }>;
		revenue: Array<{ revenue: RevenueDescriptor; context?: EventContext }>;
	} = {
		initialize: 0,
		identify: [],
		track: [],
		pageView: [],
		pageLeave: [],
		reset: 0,
		flush: [],
		group: [],
		revenue: [],
	};

	initialize(): void {
		this.calls.initialize++;
		this.initialized = true;
		this.log("Initialized");
	}

	identify(
		userId: string,
		traits?: Record<string, unknown>,
		context?: EventContext,
	): void {
		if (!this.isEnabled() || !this.initialized) return;
		this.calls.identify.push({ userId, traits, context });
		this.log("Identified user");
	}

	track(event: BaseEvent, context?: EventContext): void {
		if (!this.isEnabled() || !this.initialized) return;
		this.calls.track.push({ event, context });
		this.log("Tracked event");
	}

	pageView(properties?: Record<string, unknown>, context?: EventContext): void {
		if (!this.isEnabled() || !this.initialized) return;
		this.calls.pageView.push({ properties, context });
		this.log("Tracked page view");
	}

	pageLeave(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): void {
		if (!this.isEnabled() || !this.initialized) return;
		this.calls.pageLeave.push({ properties, context });
		this.log("Tracked page leave");
	}

	reset(): void {
		if (!this.isEnabled() || !this.initialized) return;
		this.calls.reset++;
		this.log("Reset");
	}

	group(group: GroupDescriptor, userId?: string): void {
		if (!this.isEnabled() || !this.initialized) return;
		this.calls.group.push({ group, userId });
		this.log("Grouped");
	}

	revenue(revenue: RevenueDescriptor, context?: EventContext): void {
		if (!this.isEnabled() || !this.initialized) return;
		this.calls.revenue.push({ revenue, context });
		this.log("Recorded revenue");
	}

	flush(useBeacon?: boolean): void {
		if (!this.isEnabled() || !this.initialized) return;
		this.calls.flush.push({ useBeacon });
		this.log("Flushed");
	}

	// Helper method to clear all calls
	clearCalls(): void {
		this.calls = {
			initialize: 0,
			identify: [],
			track: [],
			pageView: [],
			pageLeave: [],
			reset: 0,
			flush: [],
			group: [],
			revenue: [],
		};
	}

	// Helper to check if initialized (for testing)
	isInitialized(): boolean {
		return this.initialized;
	}
}

export class DeferredInitializeProvider extends MockAnalyticsProvider {
	private initializationPromise?: Promise<void>;
	private resolveInitialization?: () => void;
	private rejectInitialization?: (error: Error) => void;

	override initialize(): Promise<void> {
		this.calls.initialize++;
		this.initializationPromise = new Promise<void>((resolve, reject) => {
			this.resolveInitialization = resolve;
			this.rejectInitialization = reject;
		}).then(() => {
			super.initialize();
			this.calls.initialize--;
		});
		return this.initializationPromise;
	}

	resolveInitialize(): void {
		this.resolveInitialization?.();
	}

	rejectInitialize(error: Error): void {
		void this.initializationPromise?.catch(() => undefined);
		this.rejectInitialization?.(error);
	}
}
