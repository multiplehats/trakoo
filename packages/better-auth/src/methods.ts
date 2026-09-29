import type { AuthMethod, SignInProperties } from "./events.js";
import type { EndpointContext } from "./request.js";

/** How a request signs in: the `method` and `provider?` event properties. */
export type SignInMethod = SignInProperties;

/** Paths that sign a user in (or up) when they set a new session. */
const exactPaths: Record<string, AuthMethod> = {
	"/sign-up/email": "email",
	"/sign-in/email": "email",
	"/sign-in/username": "username",
	"/sign-in/social": "social",
	"/sign-in/email-otp": "email_otp",
	"/email-otp/verify-email": "email_otp",
	"/sign-in/phone-number": "phone_number",
	"/phone-number/verify": "phone_number",
	"/magic-link/verify": "magic_link",
	"/passkey/verify-authentication": "passkey",
	"/one-tap/callback": "one_tap",
	"/siwe/verify": "siwe",
	"/verify-email": "email_verification",
	"/two-factor/verify-totp": "two_factor",
	"/two-factor/verify-otp": "two_factor",
	"/two-factor/verify-backup-code": "two_factor",
	"/sso/callback": "sso",
	"/sign-in/anonymous": "unknown",
};

/**
 * How the request authenticates, or `undefined` when its path is not a
 * sign-in or sign-up. `ctx.path` is the route pattern, so provider ids come
 * from `ctx.params`, as Better Auth's own `lastLoginMethod` plugin reads them.
 */
export function signInMethod(
	ctx: EndpointContext | undefined,
): SignInMethod | undefined {
	const path = ctx?.path;
	if (!path) return undefined;

	if (path.startsWith("/callback/")) {
		return withProvider("social", ctx.params?.id ?? lastSegment(path));
	}
	if (path.startsWith("/oauth2/callback/")) {
		return withProvider(
			"generic_oauth",
			ctx.params?.providerId ?? lastSegment(path),
		);
	}
	if (
		path.startsWith("/sso/callback/") ||
		path.startsWith("/sso/saml2/callback/") ||
		path.startsWith("/sso/saml2/sp/acs/")
	) {
		return withProvider("sso", ctx.params?.providerId);
	}

	const method = exactPaths[path];
	if (!method) return undefined;
	if (method === "social") {
		return withProvider(method, (ctx.body as { provider?: unknown })?.provider);
	}
	if (method === "one_tap") return withProvider(method, "google");
	return { method };
}

/** The method, with `provider` only when there is one. */
function withProvider(method: AuthMethod, provider: unknown): SignInMethod {
	return typeof provider === "string" && provider
		? { method, provider }
		: { method };
}

function lastSegment(path: string): string | undefined {
	const segment = path.split("/").pop();
	return segment && !segment.startsWith(":") ? segment : undefined;
}
