/**
 * Runs tracking work after the response without holding the request open.
 *
 * Resolution order:
 * 1. Better Auth's `advanced.backgroundTasks.handler`, when configured (for
 *    example `waitUntil` from `cloudflare:workers` or Next.js `after`).
 * 2. Vercel's request context, which `@vercel/functions` reads the same way.
 * 3. Fire-and-forget, with a one-time warning on serverless runtimes, where
 *    work left running after the response can be frozen or cancelled.
 */

type BackgroundHandler = (promise: Promise<unknown>) => void;

export interface BackgroundOptions {
	readonly advanced?: {
		readonly backgroundTasks?: { readonly handler?: BackgroundHandler };
	};
}

const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

let warnedAboutServerless = false;

function vercelWaitUntil(): BackgroundHandler | undefined {
	try {
		const store = (globalThis as Record<symbol, unknown>)[
			VERCEL_REQUEST_CONTEXT
		] as { get?: () => { waitUntil?: unknown } | undefined } | undefined;
		const waitUntil = store?.get?.()?.waitUntil;
		return typeof waitUntil === "function"
			? (waitUntil as BackgroundHandler)
			: undefined;
	} catch {
		return undefined;
	}
}

/** The serverless runtime this process runs on, when it can tell. */
export function detectServerlessRuntime(): string | undefined {
	try {
		const env = (
			globalThis as { process?: { env?: Record<string, string | undefined> } }
		).process?.env;
		if (env?.VERCEL) return "Vercel";
		if (env?.AWS_LAMBDA_FUNCTION_NAME) return "AWS Lambda";
		if (env?.NETLIFY) return "Netlify";
		const navigator = (globalThis as { navigator?: { userAgent?: string } })
			.navigator;
		if (navigator?.userAgent === "Cloudflare-Workers") {
			return "Cloudflare Workers";
		}
	} catch {
		// Environment access can throw in locked-down runtimes.
	}
	return undefined;
}

/**
 * Starts `task` and hands its promise to the runtime. The promise never
 * rejects: failures go to `onError`.
 */
export function runInBackground(
	task: () => Promise<void>,
	options: BackgroundOptions | undefined,
	onError: (error: unknown) => void,
): void {
	let promise: Promise<void>;
	try {
		promise = task().catch(onError);
	} catch (error) {
		onError(error);
		return;
	}

	try {
		const configured = options?.advanced?.backgroundTasks?.handler;
		if (typeof configured === "function") {
			configured(promise);
			return;
		}

		const waitUntil = vercelWaitUntil();
		if (waitUntil) {
			waitUntil(promise);
			return;
		}
	} catch (error) {
		// A failing handler must not fail the request; the work still runs.
		onError(error);
		return;
	}

	if (!warnedAboutServerless) {
		const runtime = detectServerlessRuntime();
		if (runtime && runtime !== "Vercel") {
			warnedAboutServerless = true;
			console.warn(
				`[trakoo/better-auth] ${runtime} can stop work that continues after the response, so auth events may be lost. Set Better Auth's advanced.backgroundTasks.handler to your runtime's waitUntil. See https://trakoo.co/docs/integrations/better-auth#serverless`,
			);
		}
	}
}

/** @internal Test hook. */
export function resetBackgroundWarning(): void {
	warnedAboutServerless = false;
}
