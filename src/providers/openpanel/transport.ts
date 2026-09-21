/**
 * OpenPanel's SDKs treat HTTP 401 as a non-error: their shared `Api.post`
 * returns `null` without throwing, retrying or logging, so a wrong, rotated or
 * origin-rejected key stops analytics silently. Both the browser and the server
 * SDK send through the `api` instance they expose publicly, so trakoo replaces
 * that instance's `fetch` with an equivalent implementation that reports the
 * response status before returning the value the SDK expects.
 *
 * The replacement mirrors the SDK transport: 200 and 202 are the only success
 * statuses, 401 is never retried, every other failure backs off exponentially,
 * and headers, body and request options are built the same way. Delivery still
 * resolves rather than throwing, so reporting a failure can never turn a
 * tracked event into an application error.
 */

export type OpenPanelDeliveryFailureReason =
	| "network_error"
	| "server_error"
	| "unauthorized";

export interface OpenPanelDeliveryFailure {
	/** Requests made for this event, including the one that failed. */
	readonly attempts: number;
	/** OpenPanel envelope type such as `track` or `identify`, never a payload. */
	readonly payloadType?: string;
	readonly reason: OpenPanelDeliveryFailureReason;
	/** Absent when the request never produced a response. */
	readonly status?: number;
	/** Ingestion endpoint the event was sent to. */
	readonly url: string;
}

export type OpenPanelDeliveryFailureHandler = (
	failure: OpenPanelDeliveryFailure,
) => void;

/**
 * Request attributes OpenPanel reads from headers rather than from the event
 * body: the caller's IP resolves geo, and the user agent resolves the device.
 */
export interface OpenPanelRequestContext {
	readonly ip?: string;
	readonly userAgent?: string;
}

/**
 * Where the server provider parks {@link OpenPanelRequestContext} on the
 * payload it hands the SDK.
 *
 * OpenPanel's own server integrations build a fresh client per request and
 * call `api.addHeader()` on it. A trakoo provider is long-lived and shared by
 * every concurrent request, so mutating those headers would attribute one
 * caller's event to another caller's IP. Carrying the values on the payload
 * keeps them bound to the single event they describe and survives the SDK's
 * internal queue, which spreads the properties object.
 *
 * The key is a symbol, so no event property can impersonate it and turn
 * tracked data into request headers. It also cannot be serialized:
 * `JSON.stringify` drops symbol keys, so the carrier never reaches OpenPanel
 * as a property even when this transport is not installed.
 */
export const REQUEST_CONTEXT: unique symbol = Symbol(
	"trakoo.openpanel.requestContext",
);

const CLIENT_IP_HEADER = "openpanel-client-ip";
const USER_AGENT_HEADER = "user-agent";

const DEFAULT_INITIAL_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 3;
const SUCCESS_STATUSES = new Set([200, 202]);
const UNAUTHORIZED_STATUS = 401;

/** The transport surface both OpenPanel SDKs expose as `client.api`. */
interface OpenPanelApi {
	baseUrl: string;
	fetch: (
		path: string,
		data: unknown,
		options?: RequestInit,
	) => Promise<unknown>;
	headers: Record<string, string | Promise<string | null>>;
	initialRetryDelay?: number;
	maxRetries?: number;
}

type DeliveryAttempt =
	| { readonly body: unknown; readonly ok: true }
	| {
			readonly ok: false;
			readonly reason: OpenPanelDeliveryFailureReason;
			readonly status?: number;
	  };

/**
 * Replaces the transport of an OpenPanel client so rejected requests are
 * reported. Returns `false` when the client does not expose the expected
 * transport, in which case the SDK keeps delivering events unchanged.
 */
export function instrumentOpenPanelDelivery(
	client: unknown,
	report: OpenPanelDeliveryFailureHandler,
): boolean {
	const api = openPanelApiOf(client);
	if (!api) return false;

	api.fetch = (path, data, options) =>
		deliver(api, path, data, options, report);
	return true;
}

/**
 * Wraps a caller-supplied handler so it can never fail an analytics call, and
 * logs the failure when no handler is configured. OpenPanel drops rejected
 * requests silently, so a missing handler must not mean missing signal.
 */
export function createDeliveryFailureReporter(
	providerName: string,
	onDeliveryFailure: OpenPanelDeliveryFailureHandler | undefined,
): OpenPanelDeliveryFailureHandler {
	return (failure) => {
		if (!onDeliveryFailure) {
			logDeliveryFailure(providerName, failure);
			return;
		}
		try {
			onDeliveryFailure(failure);
		} catch {
			// Delivery reporting must not change the outcome of a tracked event.
		}
	};
}

function openPanelApiOf(client: unknown): OpenPanelApi | undefined {
	// `Api` is not exported by the SDK, so its instance is matched structurally.
	const api = (client as { api?: unknown } | undefined)?.api;
	if (!api || typeof api !== "object") return undefined;

	const candidate = api as Partial<OpenPanelApi>;
	if (typeof candidate.fetch !== "function") return undefined;
	if (typeof candidate.baseUrl !== "string") return undefined;
	if (!candidate.headers || typeof candidate.headers !== "object") {
		return undefined;
	}
	return candidate as OpenPanelApi;
}

async function deliver(
	api: OpenPanelApi,
	path: string,
	data: unknown,
	options: RequestInit | undefined,
	report: OpenPanelDeliveryFailureHandler,
): Promise<unknown> {
	const url = `${api.baseUrl}${path}`;
	const payloadType = payloadTypeOf(data);
	const headers = requestHeadersOf(data);
	const maxRetries = nonNegativeNumber(api.maxRetries, DEFAULT_MAX_RETRIES);
	const retryDelay = nonNegativeNumber(
		api.initialRetryDelay,
		DEFAULT_INITIAL_RETRY_DELAY_MS,
	);

	for (let attempt = 0; ; attempt += 1) {
		const outcome = await attemptDelivery(api, url, data, options, headers);
		if (outcome.ok) return outcome.body;

		// A rejected key is rejected for every retry, so it is reported at once.
		if (outcome.reason !== "unauthorized" && attempt < maxRetries) {
			await wait(retryDelay * 2 ** attempt);
			continue;
		}

		report({
			attempts: attempt + 1,
			...(payloadType && { payloadType }),
			reason: outcome.reason,
			...(outcome.status !== undefined && { status: outcome.status }),
			url,
		});
		return null;
	}
}

async function attemptDelivery(
	api: OpenPanelApi,
	url: string,
	data: unknown,
	options: RequestInit | undefined,
	requestHeaders: Record<string, string>,
): Promise<DeliveryAttempt> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { ...(await resolveHeaders(api.headers)), ...requestHeaders },
			body: data ? JSON.stringify(data) : undefined,
			keepalive: true,
			...options,
		});

		if (response.status === UNAUTHORIZED_STATUS) {
			return { ok: false, reason: "unauthorized", status: UNAUTHORIZED_STATUS };
		}
		if (!SUCCESS_STATUSES.has(response.status)) {
			return { ok: false, reason: "server_error", status: response.status };
		}

		const text = await response.text();
		return { body: text ? JSON.parse(text) : null, ok: true };
	} catch {
		return { ok: false, reason: "network_error" };
	}
}

async function resolveHeaders(
	headers: OpenPanelApi["headers"],
): Promise<Record<string, string>> {
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const header = await value;
		if (header !== null) resolved[key] = header;
	}
	return resolved;
}

/**
 * Turns any {@link OpenPanelRequestContext} carried by the payload into this
 * one request's headers. The payload itself is left untouched — the carrier is
 * symbol-keyed, so it is already invisible to `JSON.stringify`.
 */
function requestHeadersOf(data: unknown): Record<string, string> {
	const requestContext = propertiesOf(data)?.[REQUEST_CONTEXT];
	if (!requestContext || typeof requestContext !== "object") return {};

	const { ip, userAgent } = requestContext as OpenPanelRequestContext;

	return {
		...(typeof ip === "string" && ip && { [CLIENT_IP_HEADER]: ip }),
		...(typeof userAgent === "string" &&
			userAgent && { [USER_AGENT_HEADER]: userAgent }),
	};
}

function propertiesOf(data: unknown): Record<PropertyKey, unknown> | undefined {
	if (!data || typeof data !== "object") return undefined;
	const payload = (data as { payload?: unknown }).payload;
	if (!payload || typeof payload !== "object") return undefined;
	const properties = (payload as { properties?: unknown }).properties;
	if (!properties || typeof properties !== "object") return undefined;
	return properties as Record<PropertyKey, unknown>;
}

function payloadTypeOf(data: unknown): string | undefined {
	if (!data || typeof data !== "object") return undefined;
	const type = (data as { type?: unknown }).type;
	return typeof type === "string" ? type : undefined;
}

function nonNegativeNumber(
	value: number | undefined,
	fallback: number,
): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function logDeliveryFailure(
	providerName: string,
	failure: OpenPanelDeliveryFailure,
): void {
	const status =
		failure.status === undefined ? "" : ` (HTTP ${failure.status})`;
	const hint =
		failure.reason === "unauthorized"
			? " - check the OpenPanel credentials and the project's allowed origins"
			: "";
	console.error(
		`[${providerName}] Delivery failed: ${failure.reason}${status} after ${failure.attempts} attempt(s) to ${failure.url}${hint}`,
	);
}
