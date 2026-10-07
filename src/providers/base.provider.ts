import type {
	AnalyticsProvider,
	BaseEvent,
	EventContext,
	TrackInvocation,
} from "@/core/events/types.js";

export abstract class BaseAnalyticsProvider implements AnalyticsProvider {
	abstract name: string;
	protected debug = false;
	protected enabled = true;

	constructor(config?: { debug?: boolean; enabled?: boolean }) {
		if (config?.debug !== undefined) this.debug = config.debug;
		if (config?.enabled !== undefined) this.enabled = config.enabled;
	}

	abstract initialize(): Promise<void> | void;

	abstract identify(
		userId: string,
		traits?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> | void;

	abstract track(
		event: BaseEvent,
		context?: EventContext,
		invocation?: TrackInvocation,
	): Promise<void> | void;

	abstract pageView(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> | void;

	pageLeave?(
		properties?: Record<string, unknown>,
		context?: EventContext,
	): Promise<void> | void;

	abstract reset(): Promise<void> | void;

	protected log(message: string): void {
		if (this.debug) {
			console.log(`[${this.name}] ${message}`);
		}
	}

	protected getErrorClass(error: unknown): string {
		try {
			if (error instanceof TypeError) return "TypeError";
			if (error instanceof RangeError) return "RangeError";
			if (error instanceof ReferenceError) return "ReferenceError";
			if (error instanceof SyntaxError) return "SyntaxError";
			if (error instanceof URIError) return "URIError";
			if (error instanceof EvalError) return "EvalError";
			if (error instanceof Error) return "Error";
		} catch {
			// Error classification must never replace the original failure.
		}
		return "UnknownError";
	}

	protected isEnabled(): boolean {
		return this.enabled;
	}
}
