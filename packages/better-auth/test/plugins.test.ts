import {
	admin,
	anonymous,
	emailOTP,
	magicLink,
	phoneNumber,
	twoFactor,
	username,
} from "better-auth/plugins";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cookiesFrom,
	createHarness,
	expectNoSecrets,
	type Harness,
	PASSWORD,
} from "./helpers.js";

let harness: Harness | undefined;
afterEach(() => {
	if (harness) expectNoSecrets(harness);
	harness = undefined;
	vi.restoreAllMocks();
});

describe("admin plugin", () => {
	async function setupAdmin() {
		harness = await createHarness({ plugins: [admin()] });
		const adminUser = await harness.signUp("admin@example.com", "Admin");
		harness.db.user[0].role = "admin";
		const target = await harness.signUp("ada@example.com", "Ada");
		await harness.flush();
		harness.provider.clear();
		return { harness, adminUser, target };
	}

	it("reports bans, role changes and created users with the acting admin", async () => {
		const { adminUser, target } = await setupAdmin();
		const h = harness as Harness;
		const headers = adminUser.headers;

		await h.api.banUser({
			headers,
			body: {
				userId: target.userId,
				banReason: "spam from 203.0.113.7",
				banExpiresIn: 3600,
			},
		});
		await h.api.unbanUser({ headers, body: { userId: target.userId } });
		await h.api.setRole({
			headers,
			body: { userId: target.userId, role: "admin" },
		});
		const created = await h.api.createUser({
			headers,
			body: {
				email: "charles@example.com",
				password: PASSWORD,
				name: "Charles",
				role: "user",
			},
		});
		await h.flush();

		expect(h.provider.names()).toEqual([
			"user_banned",
			"user_unbanned",
			"user_role_changed",
			"user_created_by_admin",
		]);
		expect(h.provider.find("user_banned")).toMatchObject({
			userId: target.userId,
			properties: {
				actorUserId: adminUser.userId,
				expiresAt: expect.any(String),
			},
		});
		expect(JSON.stringify(h.provider.tracked)).not.toContain("spam");
		expect(h.provider.find("user_role_changed").properties.role).toBe("admin");
		expect(h.provider.find("user_created_by_admin")).toMatchObject({
			userId: created.user.id,
			properties: { actorUserId: adminUser.userId, role: "user" },
		});
		// An admin-created user is identified but is not a sign-up.
		expect(h.provider.names()).not.toContain("user_signed_up");
		expect(h.provider.identified.map((call) => call.userId)).toEqual([
			created.user.id,
		]);
	});

	it("reports impersonation without the impersonation session token", async () => {
		const { adminUser, target } = await setupAdmin();
		const h = harness as Harness;

		const started = await h.api.impersonateUser({
			headers: adminUser.headers,
			body: { userId: target.userId },
			returnHeaders: true,
		});
		h.secrets.add(started.response.session.token);
		await h.api.stopImpersonating({ headers: cookiesFrom(started.headers) });
		await h.flush();

		expect(h.provider.names()).toEqual([
			"user_impersonation_started",
			"user_impersonation_stopped",
		]);
		for (const call of h.provider.tracked) {
			expect(call).toMatchObject({
				userId: target.userId,
				properties: { actorUserId: adminUser.userId },
			});
		}
	});

	it("reports a user removed by an admin", async () => {
		const { adminUser, target } = await setupAdmin();
		const h = harness as Harness;

		await h.api.removeUser({
			headers: adminUser.headers,
			body: { userId: target.userId },
		});
		await h.flush();

		expect(h.provider.names()).toEqual(["user_deleted"]);
		expect(h.provider.find("user_deleted")).toMatchObject({
			userId: target.userId,
			properties: { deletedBy: "admin", actorUserId: adminUser.userId },
		});
	});
});

describe("two-factor plugin", () => {
	it("reports enabling 2FA once verified, and a sign-in only after the second factor", async () => {
		let otp = "";
		harness = await createHarness({
			plugins: [
				twoFactor({
					otpOptions: {
						sendOTP: async ({ otp: code }) => {
							otp = code;
						},
					},
				}),
			],
			tables: ["twoFactor"],
		});
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		const enabling = await harness.api.enableTwoFactor({
			headers,
			body: { password: PASSWORD },
			returnHeaders: true,
		});
		const enabled = enabling.response;
		harness.secrets.add(enabled.totpURI);
		for (const code of enabled.backupCodes) harness.secrets.add(code);
		const totpSecret = /secret=([^&]+)/.exec(enabled.totpURI)?.[1];
		if (totpSecret) harness.secrets.add(totpSecret);
		// Enabling can rotate the session.
		const rotated =
			enabling.headers.getSetCookie().length > 0
				? cookiesFrom(enabling.headers)
				: headers;
		await harness.api.sendTwoFactorOTP({ headers: rotated, body: {} });
		harness.secrets.add(otp);
		await harness.api.verifyTwoFactorOTP({
			headers: rotated,
			body: { code: otp },
		});
		await harness.flush();
		expect(harness.provider.names()).toContain("two_factor_enabled");
		expect(harness.provider.names()).not.toContain("user_signed_in");
		harness.provider.clear();

		// The first factor alone is not a sign-in.
		const pending = await harness.api.signInEmail({
			body: { email: "ada@example.com", password: PASSWORD },
			returnHeaders: true,
		});
		expect(pending.response.twoFactorRedirect).toBe(true);
		await harness.flush();
		expect(harness.provider.tracked).toEqual([]);

		const cookieHeaders = cookiesFrom(pending.headers);
		await harness.api.sendTwoFactorOTP({ headers: cookieHeaders, body: {} });
		harness.secrets.add(otp);
		const verifying = await harness.api.verifyTwoFactorOTP({
			headers: cookieHeaders,
			body: { code: otp },
			returnHeaders: true,
		});
		harness.secrets.add(verifying.response.token);
		await harness.flush();

		expect(harness.provider.names()).toEqual(["user_signed_in"]);
		expect(harness.provider.find("user_signed_in")).toMatchObject({
			userId,
			properties: { method: "two_factor", twoFactor: true },
		});

		harness.provider.clear();
		await harness.api.disableTwoFactor({
			headers: cookiesFrom(verifying.headers),
			body: { password: PASSWORD },
		});
		await harness.flush();
		expect(harness.provider.names()).toEqual(["two_factor_disabled"]);
	});

	it("warns when trakooAuth is registered before twoFactor", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		harness = await createHarness({
			plugins: [twoFactor()],
			tables: ["twoFactor"],
			trakooFirst: true,
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Register trakooAuth() after twoFactor()"),
		);
	});
});

describe("anonymous plugin", () => {
	it("reports an anonymous user, then the link when they sign up", async () => {
		harness = await createHarness({ plugins: [anonymous()] });

		const anon = await harness.api.signInAnonymous({ returnHeaders: true });
		harness.secrets.add(anon.response.token);
		const cookie = (anon.headers.get("set-cookie") ?? "").split(";")[0];
		await harness.flush();

		expect(harness.provider.names()).toEqual(["anonymous_user_created"]);
		// Anonymous users are not identified: their email is a placeholder.
		expect(harness.provider.identified).toEqual([]);
		const anonymousUserId = harness.provider.find(
			"anonymous_user_created",
		).userId;
		harness.provider.clear();

		const signedUp = await harness.api.signUpEmail({
			headers: new Headers({ cookie }),
			body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
		});
		harness.secrets.add(signedUp.token);
		await harness.flush();

		expect(harness.provider.names()).toEqual([
			"user_signed_up",
			"anonymous_user_linked",
		]);
		expect(harness.provider.find("anonymous_user_linked")).toMatchObject({
			userId: signedUp.user.id,
			properties: { anonymousUserId },
		});
		// Deleting the linked anonymous user is not a deleted account.
		expect(harness.provider.names()).not.toContain("user_deleted");
	});

	it("reports the link when the anonymous user is kept", async () => {
		const onLinkAccount = vi.fn();
		harness = await createHarness({
			plugins: [anonymous({ disableDeleteAnonymousUser: true, onLinkAccount })],
		});
		const anon = await harness.api.signInAnonymous({ returnHeaders: true });
		harness.secrets.add(anon.response.token);
		const cookie = (anon.headers.get("set-cookie") ?? "").split(";")[0];
		await harness.flush();
		harness.provider.clear();

		const signedUp = await harness.api.signUpEmail({
			headers: new Headers({ cookie }),
			body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
		});
		harness.secrets.add(signedUp.token);
		await harness.flush();

		expect(onLinkAccount).toHaveBeenCalledOnce();
		expect(harness.provider.names()).toEqual([
			"user_signed_up",
			"anonymous_user_linked",
		]);
	});
});

describe("passwordless sign-in plugins", () => {
	it("labels a magic link sign-up and sign-in without the link token", async () => {
		let magicToken = "";
		harness = await createHarness({
			plugins: [
				magicLink({
					sendMagicLink: async ({ token }) => {
						magicToken = token;
					},
				}),
			],
		});

		const signInWithLink = async () => {
			await harness?.api.signInMagicLink({
				body: { email: "ada@example.com" },
				headers: new Headers(),
			});
			harness?.secrets.add(magicToken);
			const result = await harness?.api.magicLinkVerify({
				query: { token: magicToken },
				headers: new Headers(),
			});
			harness?.secrets.add(result.token);
			return result;
		};

		const first = await signInWithLink();
		await harness.flush();
		expect(harness.provider.names()).toEqual(["user_signed_up"]);
		expect(harness.provider.find("user_signed_up")).toMatchObject({
			userId: first.user.id,
			properties: { method: "magic_link" },
		});
		harness.provider.clear();

		await signInWithLink();
		await harness.flush();
		expect(harness.provider.names()).toEqual(["user_signed_in"]);
		expect(harness.provider.find("user_signed_in").properties.method).toBe(
			"magic_link",
		);
	});

	it("labels an email OTP sign-up without the code", async () => {
		let code = "";
		harness = await createHarness({
			plugins: [
				emailOTP({
					sendVerificationOTP: async ({ otp }) => {
						code = otp;
					},
				}),
			],
		});

		await harness.api.sendVerificationOTP({
			body: { email: "ada@example.com", type: "sign-in" },
		});
		harness.secrets.add(code);
		const result = await harness.api.signInEmailOTP({
			body: { email: "ada@example.com", otp: code },
		});
		harness.secrets.add(result.token);
		await harness.flush();

		expect(harness.provider.names()).toEqual(["user_signed_up"]);
		expect(harness.provider.find("user_signed_up").properties.method).toBe(
			"email_otp",
		);
	});

	it("labels a username sign-in", async () => {
		harness = await createHarness({ plugins: [username()] });
		await harness.api.signUpEmail({
			body: {
				email: "ada@example.com",
				password: PASSWORD,
				name: "Ada",
				username: "ada",
			},
		});
		await harness.flush();
		harness.provider.clear();

		const result = await harness.api.signInUsername({
			body: { username: "ada", password: PASSWORD },
		});
		harness.secrets.add(result.token);
		await harness.flush();

		expect(harness.provider.names()).toEqual(["user_signed_in"]);
		expect(harness.provider.find("user_signed_in").properties.method).toBe(
			"username",
		);
	});

	it("reports a verified phone number without the code", async () => {
		let code = "";
		harness = await createHarness({
			plugins: [
				phoneNumber({
					sendOTP: async ({ code: sent }) => {
						code = sent;
					},
				}),
			],
		});
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		await harness.api.sendPhoneNumberOTP({
			body: { phoneNumber: "+15555550100" },
		});
		harness.secrets.add(code);
		await harness.api.verifyPhoneNumber({
			headers,
			body: {
				phoneNumber: "+15555550100",
				code,
				updatePhoneNumber: true,
				disableSession: true,
			},
		});
		await harness.flush();

		expect(harness.provider.names()).toContain("phone_number_verified");
		expect(harness.provider.find("phone_number_verified").userId).toBe(userId);
		expect(JSON.stringify(harness.provider.tracked)).not.toContain(
			"+15555550100",
		);
	});
});
