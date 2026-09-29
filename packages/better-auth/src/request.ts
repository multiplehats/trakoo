/**
 * The parts of a Better Auth endpoint context the plugin reads. Typed
 * structurally so the plugin works across Better Auth releases.
 */
export interface EndpointContext {
	path?: string;
	params?: Record<string, string | undefined>;
	body?: unknown;
	headers?: Headers;
	request?: Request;
	context: {
		returned?: unknown;
		newSession?: { user: AuthUser; session: AuthSession } | null;
		session?: { user: AuthUser; session: AuthSession } | null;
		options?: RequestOptions;
	};
}

export interface AuthUser {
	id: string;
	email?: string | null;
	name?: string | null;
	emailVerified?: boolean | null;
	createdAt?: Date | string | null;
	isAnonymous?: boolean | null;
	[key: string]: unknown;
}

export interface AuthSession {
	id: string;
	userId: string;
	impersonatedBy?: string | null;
	[key: string]: unknown;
}

interface RequestOptions {
	advanced?: {
		ipAddress?: {
			ipAddressHeaders?: string[];
			disableIpTracking?: boolean;
		};
	};
}

const BETTER_AUTH_GLOBAL = Symbol.for("better-auth:global");

/**
 * The endpoint context of the Better Auth call in progress. Better Auth keeps
 * it in an AsyncLocalStorage on a process-wide global (shared by every copy of
 * the library). Plugin option callbacks such as `organizationHooks` do not
 * receive it, so this is how they learn the path and the acting user.
 * Returns `undefined` outside a call or if Better Auth ever moves it.
 */
export function currentEndpointContext(): EndpointContext | undefined {
	try {
		const global = (globalThis as Record<symbol, unknown>)[
			BETTER_AUTH_GLOBAL
		] as
			| {
					context?: {
						endpointContextAsyncStorage?: { getStore?: () => unknown };
					};
			  }
			| undefined;
		const store = global?.context?.endpointContextAsyncStorage?.getStore?.();
		return isEndpointContext(store) ? store : undefined;
	} catch {
		return undefined;
	}
}

function isEndpointContext(value: unknown): value is EndpointContext {
	return (
		typeof value === "object" &&
		value !== null &&
		"context" in value &&
		typeof value.context === "object" &&
		value.context !== null
	);
}

export interface RequestInfo {
	ip?: string;
	userAgent?: string;
}

function headersOf(ctx: EndpointContext | undefined): Headers | undefined {
	const headers = ctx?.headers ?? ctx?.request?.headers;
	return headers instanceof Headers ? headers : undefined;
}

/**
 * The caller's IP address and user agent. Honors Better Auth's
 * `advanced.ipAddress` settings, so disabling IP tracking there also keeps it
 * out of analytics.
 */
export function requestInfo(
	ctx: EndpointContext | undefined,
): RequestInfo | undefined {
	try {
		const headers = headersOf(ctx);
		if (!headers) return undefined;
		const ipOptions = ctx?.context.options?.advanced?.ipAddress;
		const info: RequestInfo = {};

		const userAgent = headers.get("user-agent");
		if (userAgent) info.userAgent = userAgent;

		if (!ipOptions?.disableIpTracking) {
			for (const name of ipOptions?.ipAddressHeaders ?? ["x-forwarded-for"]) {
				const ip = headers.get(name)?.split(",")[0]?.trim();
				if (ip) {
					info.ip = ip;
					break;
				}
			}
		}

		return info.ip || info.userAgent ? info : undefined;
	} catch {
		return undefined;
	}
}

/** Whether an after-hook's result is a success. A redirect counts as one. */
export function succeeded(returned: unknown): boolean {
	if (returned instanceof Response) return returned.status < 400;
	if (typeof returned !== "object" || returned === null) return true;
	if (returned instanceof Error) {
		const status = (returned as { statusCode?: unknown }).statusCode;
		return typeof status === "number" && status >= 300 && status < 400;
	}
	return true;
}

/** Reads a string field of an unknown object. */
export function stringField(value: unknown, key: string): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" && field ? field : undefined;
}

export function objectField(value: unknown, key: string): unknown {
	if (typeof value !== "object" || value === null) return undefined;
	return (value as Record<string, unknown>)[key];
}

export function isoDate(value: unknown): string | undefined {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value.toISOString();
	}
	if (typeof value === "string" && value) return value;
	return undefined;
}
