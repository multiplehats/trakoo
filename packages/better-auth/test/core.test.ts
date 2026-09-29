import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { afterEach, describe, expect, it } from "vitest";
import { authEventDefaults } from "../src/index.js";
import {
	createHarness,
	expectNoSecrets,
	type Harness,
	PASSWORD,
} from "./helpers.js";

let harness: Harness | undefined;
afterEach(() => {
	if (harness) expectNoSecrets(harness);
	harness = undefined;
});

const coreEvents = Object.entries(authEventDefaults)
	.filter(([, defaults]) => !defaults.plugin)
	.map(([key]) => key);

const withRequest = (headers: Headers) => {
	const next = new Headers(headers);
	next.set("user-agent", "Mozilla/5.0 (trakoo test)");
	next.set("x-forwarded-for", "203.0.113.7, 10.0.0.1");
	return next;
};

describe("core Better Auth", () => {
	it("registers only the core events when no plugin is installed", async () => {
		harness = await createHarness();
		expect([...harness.plugin.activeEvents].sort()).toEqual(
			[...coreEvents].sort(),
		);
	});

	it("reports a sign-up once, identified, with the email only in the user context", async () => {
		harness = await createHarness();
		const result = await harness.api.signUpEmail({
			body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
			headers: withRequest(new Headers()),
			returnHeaders: true,
		});
		harness.secrets.add(result.response.token);
		const userId = result.response.user.id;
		await harness.flush();

		expect(harness.provider.names()).toEqual(["user_signed_up"]);
		const event = harness.provider.find("user_signed_up");
		expect(event).toEqual({
			name: "user_signed_up",
			category: "user",
			userId,
			sessionId: undefined,
			properties: {
				method: "email",
				emailVerified: false,
				__emitkit_channel: "auth",
				__emitkit_notify: true,
			},
			context: {
				user: { userId, email: "ada@example.com" },
				server: { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (trakoo test)" },
			},
		});
		expect(JSON.stringify(event.properties)).not.toContain("ada@example.com");
		expect(harness.provider.identified).toEqual([
			{
				userId,
				traits: {
					email: "ada@example.com",
					name: "Ada",
					createdAt: expect.any(String),
					emailVerified: false,
				},
			},
		]);
	});

	it("reports a sign-up that waits for email verification", async () => {
		harness = await createHarness({
			options: {
				emailAndPassword: { enabled: true, requireEmailVerification: true },
			},
		});
		await harness.api.signUpEmail({
			body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
		});
		await harness.flush();
		expect(harness.provider.names()).toEqual(["user_signed_up"]);
	});

	it("reports a sign-in with its session id and identifies the user", async () => {
		harness = await createHarness();
		const { userId } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		const result = await harness.api.signInEmail({
			body: { email: "ada@example.com", password: PASSWORD },
			headers: withRequest(new Headers()),
			returnHeaders: true,
		});
		harness.secrets.add(result.response.token);
		await harness.flush();

		const session = harness.db.session.find(
			(row) => row.token === result.response.token,
		);
		expect(harness.provider.names()).toEqual(["user_signed_in"]);
		expect(harness.provider.find("user_signed_in")).toMatchObject({
			userId,
			sessionId: session?.id,
			properties: {
				method: "email",
				twoFactor: false,
				__emitkit_channel: "auth",
				__emitkit_notify: false,
			},
			context: { server: { ip: "203.0.113.7" } },
		});
		expect(
			harness.provider.find("user_signed_in").context?.user,
		).toBeUndefined();
		expect(harness.provider.identified).toHaveLength(1);
	});

	it("reports nothing for a failed sign-in or a rejected sign-up", async () => {
		harness = await createHarness();
		await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		await expect(
			harness.api.signInEmail({
				body: { email: "ada@example.com", password: "wrong-password-123" },
			}),
		).rejects.toThrow();
		await expect(
			harness.api.signUpEmail({
				body: { email: "ada@example.com", password: PASSWORD, name: "Again" },
			}),
		).rejects.toThrow();
		await harness.flush();

		expect(harness.provider.tracked).toEqual([]);
		expect(harness.provider.identified).toEqual([]);
	});

	it("reports nothing when the sign-up transaction rolls back", async () => {
		harness = await createHarness({
			options: {
				databaseHooks: {
					account: {
						create: {
							before: async () => {
								throw new Error("storage unavailable");
							},
						},
					},
				},
			},
		});

		await expect(harness.signUp()).rejects.toThrow();
		await harness.flush();

		expect(harness.db.user).toEqual([]);
		expect(harness.provider.tracked).toEqual([]);
	});

	it("reports a sign-out", async () => {
		harness = await createHarness();
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		await harness.api.signOut({ headers });
		await harness.flush();

		// Reading the session first leaves sign-out itself unchanged.
		expect(await harness.api.getSession({ headers })).toBeNull();
		expect(harness.db.session).toEqual([]);
		expect(harness.provider.names()).toEqual(["user_signed_out"]);
		expect(harness.provider.find("user_signed_out")).toMatchObject({
			userId,
			sessionId: expect.any(String),
			properties: { __emitkit_channel: "auth", __emitkit_notify: false },
		});
	});

	it("reports revoked sessions with their scope", async () => {
		harness = await createHarness();
		const { userId, headers } = await harness.signUp();
		const other = await harness.signIn("ada@example.com");
		await harness.flush();
		harness.provider.clear();

		await harness.api.revokeSession({ headers, body: { token: other.token } });
		await harness.api.revokeOtherSessions({ headers });
		await harness.api.revokeSessions({ headers });
		await harness.flush();

		expect(
			harness.provider.tracked.map((call) => call.properties.scope),
		).toEqual(["one", "others", "all"]);
		for (const call of harness.provider.tracked) {
			expect(call).toMatchObject({ name: "sessions_revoked", userId });
		}
	});

	it("reports a password change without the password", async () => {
		harness = await createHarness();
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		const newPassword = "an-even-better-passphrase";
		harness.secrets.add(newPassword);
		const result = await harness.api.changePassword({
			headers,
			body: {
				currentPassword: PASSWORD,
				newPassword,
				revokeOtherSessions: true,
			},
		});
		if (result.token) harness.secrets.add(result.token);
		await harness.flush();

		expect(harness.provider.names()).toEqual(["password_changed"]);
		expect(harness.provider.find("password_changed")).toMatchObject({
			userId,
			properties: { revokedOtherSessions: true },
		});
	});

	it("reports a completed password reset without the reset token", async () => {
		let resetToken = "";
		harness = await createHarness({
			options: {
				emailAndPassword: {
					enabled: true,
					sendResetPassword: async ({ token }) => {
						resetToken = token;
					},
				},
			},
		});
		const { userId } = await harness.signUp();
		await harness.api.requestPasswordReset({
			body: { email: "ada@example.com" },
		});
		await harness.flush();
		harness.provider.clear();
		harness.secrets.add(resetToken);

		await harness.api.resetPassword({
			body: { token: resetToken, newPassword: "a-brand-new-passphrase" },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual(["password_reset"]);
		expect(harness.provider.find("password_reset").userId).toBe(userId);
	});

	it("reports a profile update with field names and identifies with the new name", async () => {
		harness = await createHarness();
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		await harness.api.updateUser({
			headers,
			body: { name: "Ada King", image: "https://example.com/ada.png" },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual(["user_profile_updated"]);
		const event = harness.provider.find("user_profile_updated");
		expect(event.userId).toBe(userId);
		expect(event.properties.fields).toEqual(
			expect.arrayContaining(["name", "image"]),
		);
		expect(JSON.stringify(event.properties)).not.toContain("Ada King");
		expect(harness.provider.identified).toEqual([
			{ userId, traits: expect.objectContaining({ name: "Ada King" }) },
		]);
	});

	it("reports an email change and identifies with the new email", async () => {
		harness = await createHarness({
			options: {
				user: {
					changeEmail: { enabled: true, updateEmailWithoutVerification: true },
				},
			},
		});
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		await harness.api.changeEmail({
			headers,
			body: { newEmail: "countess@example.com" },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual(["email_changed"]);
		expect(harness.provider.find("email_changed")).toMatchObject({
			userId,
			properties: { emailVerified: false },
		});
		expect(JSON.stringify(harness.provider.tracked)).not.toContain(
			"countess@example.com",
		);
		expect(harness.provider.identified).toEqual([
			{
				userId,
				traits: expect.objectContaining({ email: "countess@example.com" }),
			},
		]);
	});

	it("reports a verified email without the verification token", async () => {
		let verificationToken = "";
		harness = await createHarness({
			options: {
				emailVerification: {
					sendVerificationEmail: async ({ token }) => {
						verificationToken = token;
					},
				},
			},
		});
		const { userId } = await harness.signUp();
		await harness.api.sendVerificationEmail({
			body: { email: "ada@example.com" },
		});
		await harness.flush();
		harness.provider.clear();
		harness.secrets.add(verificationToken);

		await harness.api.verifyEmail({ query: { token: verificationToken } });
		await harness.flush();

		expect(harness.provider.names()).toEqual(["email_verified"]);
		expect(harness.provider.find("email_verified").userId).toBe(userId);
		expect(harness.provider.identified).toEqual([
			{ userId, traits: expect.objectContaining({ emailVerified: true }) },
		]);
	});

	it("reports a deleted user", async () => {
		harness = await createHarness({
			options: { user: { deleteUser: { enabled: true } } },
		});
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		await harness.api.deleteUser({ headers, body: { password: PASSWORD } });
		await harness.flush();

		expect(harness.provider.names()).toEqual(["user_deleted"]);
		expect(harness.provider.find("user_deleted")).toMatchObject({
			userId,
			properties: { deletedBy: "self" },
		});
	});

	it("reports a linked and an unlinked account", async () => {
		// Linking a provider is an OAuth round trip; this endpoint performs the
		// same write the OAuth callback does, inside a Better Auth endpoint.
		const linkEndpoint = createAuthEndpoint(
			"/test/link-github",
			{ method: "POST", use: [sessionMiddleware] },
			async (ctx) => {
				const account = {
					userId: ctx.context.session.user.id,
					providerId: "github",
					accountId: "gh-1",
					accessToken: "gho_secret_access_token",
				};
				// The account input type changes between 1.7 releases.
				await ctx.context.internalAdapter.linkAccount(account as never);
				return ctx.json({ ok: true });
			},
		);
		harness = await createHarness({
			plugins: [{ id: "test-link", endpoints: { linkEndpoint } }],
		});
		harness.secrets.add("gho_secret_access_token");
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		await harness.api.linkEndpoint({ headers });
		const github = harness.db.account.find(
			(row) => row.providerId === "github",
		);
		// Better Auth 1.7 unlinks by the account row id, earlier releases by
		// the provider id.
		await harness.api.unlinkAccount({
			headers,
			body: { providerId: "github", accountId: github?.id },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual([
			"account_linked",
			"account_unlinked",
		]);
		for (const call of harness.provider.tracked) {
			expect(call).toMatchObject({
				userId,
				properties: { provider: "github" },
			});
		}
	});
	it("labels a social sign-up and sign-in with the provider, without linking noise", async () => {
		harness = await createHarness({
			options: {
				socialProviders: {
					google: {
						clientId: "google-client",
						clientSecret: "google-client-secret",
						// Stand in for Google's token verification and userinfo.
						verifyIdToken: async () => true,
						getUserInfo: async () =>
							({
								user: {
									id: "google-user-1",
									email: "ada@example.com",
									name: "Ada",
									emailVerified: true,
								},
								data: { sub: "google-user-1" },
							}) as never,
					},
				},
			},
		});
		harness.secrets.add("google-client-secret");
		harness.secrets.add("google-id-token-value");
		const signIn = async () => {
			const result = await harness?.api.signInSocial({
				body: {
					provider: "google",
					idToken: { token: "google-id-token-value" },
				},
			});
			harness?.secrets.add(result.token);
			return result;
		};

		const first = await signIn();
		await harness.flush();
		expect(harness.provider.names()).toEqual(["user_signed_up"]);
		expect(harness.provider.find("user_signed_up")).toMatchObject({
			userId: first.user.id,
			properties: { method: "social", provider: "google", emailVerified: true },
		});
		harness.provider.clear();

		await signIn();
		await harness.flush();
		expect(harness.provider.names()).toEqual(["user_signed_in"]);
		expect(harness.provider.find("user_signed_in").properties).toMatchObject({
			method: "social",
			provider: "google",
		});
	});

	it("reports a sign-out when sessions live in secondary storage", async () => {
		const store = new Map<string, string>();
		const secondaryStorage = {
			get: async (key: string) => store.get(key) ?? null,
			set: async (key: string, value: string) => {
				store.set(key, value);
			},
			delete: async (key: string) => {
				store.delete(key);
			},
			getAndDelete: async (key: string) => {
				const value = store.get(key) ?? null;
				store.delete(key);
				return value;
			},
			increment: async (key: string) => {
				const next = Number(store.get(key) ?? 0) + 1;
				store.set(key, String(next));
				return next;
			},
		};
		// The storage interface grows between 1.7 releases.
		harness = await createHarness({
			options: { secondaryStorage: secondaryStorage as never },
		});
		const { userId, headers, token } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		// Better Auth keys a stored session by its token.
		expect(store.has(token)).toBe(true);

		await harness.api.signOut({ headers });
		await harness.flush();

		expect(await harness.api.getSession({ headers })).toBeNull();
		expect(store.has(token)).toBe(false);
		expect(harness.provider.names()).toEqual(["user_signed_out"]);
		expect(harness.provider.find("user_signed_out").userId).toBe(userId);
	});
});
