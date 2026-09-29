import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { stripe } from "@better-auth/stripe";
import { organization } from "better-auth/plugins";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cookiesFrom,
	createHarness,
	expectNoSecrets,
	type Harness,
} from "./helpers.js";

vi.mock("@simplewebauthn/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("@simplewebauthn/server")>()),
	// A real authenticator response needs a browser; the ceremony is Better
	// Auth's, the event is ours.
	verifyRegistrationResponse: vi.fn(async () => ({
		verified: true,
		registrationInfo: {
			aaguid: "00000000-0000-0000-0000-000000000000",
			credentialDeviceType: "multiDevice",
			credentialBackedUp: true,
			credential: {
				id: "credential-id-secret",
				publicKey: new Uint8Array([1, 2, 3, 4]),
				counter: 0,
			},
		},
	})),
}));

let harness: Harness | undefined;
afterEach(() => {
	if (harness) expectNoSecrets(harness);
	harness = undefined;
});

describe("api-key plugin", () => {
	it("reports created, updated and deleted keys without the key", async () => {
		harness = await createHarness({ plugins: [apiKey()], tables: ["apikey"] });
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		const created = await harness.api.createApiKey({
			headers,
			body: { name: "CI", expiresIn: 60 * 60 * 24 },
		});
		harness.secrets.add(created.key);
		await harness.api.updateApiKey({
			headers,
			body: { keyId: created.id, enabled: false },
		});
		await harness.api.deleteApiKey({ headers, body: { keyId: created.id } });
		await harness.flush();

		expect(harness.provider.names()).toEqual([
			"api_key_created",
			"api_key_updated",
			"api_key_deleted",
		]);
		expect(harness.provider.find("api_key_created")).toMatchObject({
			userId,
			category: "api_key",
			properties: {
				apiKeyId: created.id,
				name: "CI",
				expiresAt: expect.any(String),
				__emitkit_channel: "api-keys",
				__emitkit_notify: false,
			},
		});
		expect(harness.provider.find("api_key_updated").properties).toMatchObject({
			apiKeyId: created.id,
			enabled: false,
		});
		if (created.start) {
			expect(JSON.stringify(harness.provider.tracked)).not.toContain(
				created.start,
			);
		}
	});
});

describe("passkey plugin", () => {
	it("reports an added and a removed passkey without credential material", async () => {
		harness = await createHarness({
			plugins: [passkey({ origin: "http://localhost:3000" })],
			tables: ["passkey"],
		});
		harness.secrets.add("credential-id-secret");
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		const options = await harness.api.generatePasskeyRegistrationOptions({
			headers,
			returnHeaders: true,
		});
		const cookies = new Headers({
			cookie: `${headers.get("cookie")}; ${cookiesFrom(options.headers).get("cookie")}`,
		});
		const added = await harness.api.verifyPasskeyRegistration({
			headers: cookies,
			body: {
				name: "Laptop",
				response: {
					id: "credential-id-secret",
					rawId: "credential-id-secret",
					type: "public-key",
					clientExtensionResults: {},
					response: {
						clientDataJSON: "e30",
						attestationObject: "e30",
						transports: ["internal"],
					},
				},
			},
		});
		harness.secrets.add(added.publicKey);

		await harness.api.deletePasskey({ headers, body: { id: added.id } });
		await harness.flush();

		expect(harness.provider.names()).toEqual(["passkey_added", "passkey_removed"]);
		expect(harness.provider.find("passkey_added")).toMatchObject({
			userId,
			properties: { passkeyId: added.id, deviceType: "multiDevice" },
		});
		expect(harness.provider.find("passkey_removed")).toMatchObject({
			userId,
			properties: { passkeyId: added.id },
		});
	});
});

describe("sso plugin", () => {
	it("reports a registered and a deleted provider without its client secret", async () => {
		harness = await createHarness({ plugins: [sso()], tables: ["ssoProvider"] });
		harness.secrets.add("oidc-client-secret-value");
		const { userId, headers } = await harness.signUp();
		await harness.flush();
		harness.provider.clear();

		const registered = await harness.api.registerSSOProvider({
			headers,
			body: {
				providerId: "acme-okta",
				issuer: "https://acme.okta.example.com",
				domain: "acme.example.com",
				oidcConfig: {
					clientId: "oidc-client-id",
					clientSecret: "oidc-client-secret-value",
					skipDiscovery: true,
					authorizationEndpoint: "https://acme.okta.example.com/authorize",
					tokenEndpoint: "https://acme.okta.example.com/token",
					jwksEndpoint: "https://acme.okta.example.com/jwks",
				},
			},
		});
		if (registered.domainVerificationToken) {
			harness.secrets.add(registered.domainVerificationToken);
		}
		await harness.api.deleteSSOProvider({
			headers,
			body: { providerId: "acme-okta" },
		});
		await harness.flush();

		expect(harness.provider.names()).toEqual([
			"sso_provider_registered",
			"sso_provider_deleted",
		]);
		expect(harness.provider.find("sso_provider_registered")).toMatchObject({
			userId,
			properties: { ssoProviderId: "acme-okta", type: "oidc" },
		});
	});
});

describe("stripe plugin", () => {
	async function setupStripe(onSubscriptionComplete = vi.fn()) {
		harness = await createHarness({
			plugins: [
				organization(),
				stripe({
					// The webhook handlers under test never call Stripe.
					stripeClient: {} as never,
					stripeWebhookSecret: "whsec_test_secret",
					subscription: {
						enabled: true,
						plans: [{ name: "pro", priceId: "price_pro" }],
						onSubscriptionComplete,
					},
				}),
			],
			tables: [
				"organization",
				"member",
				"invitation",
				"subscription",
			],
		});
		harness.secrets.add("whsec_test_secret");
		const context = await harness.auth.$context;
		const subscription = (
			context.getPlugin("stripe") as unknown as {
				options: { subscription: Record<string, (data: unknown) => Promise<void>> };
			}
		).options.subscription;
		return { harness, subscription };
	}

	it("reports a user's subscription lifecycle and notifies on a new one", async () => {
		const appCallback = vi.fn();
		const { subscription } = await setupStripe(appCallback);
		const h = harness as Harness;
		const { userId } = await h.signUp();
		await h.flush();
		h.provider.clear();

		const row = {
			id: "sub_row_1",
			plan: "pro",
			status: "active",
			referenceId: userId,
			billingInterval: "month",
			stripeSubscriptionId: "sub_123",
		};
		await subscription.onSubscriptionComplete({ subscription: row, plan: { name: "pro" } });
		await subscription.onSubscriptionUpdate({ subscription: { ...row, status: "past_due" } });
		await subscription.onSubscriptionCancel({ subscription: row });
		await subscription.onSubscriptionDeleted({ subscription: { ...row, status: "canceled" } });
		await h.flush();

		expect(appCallback).toHaveBeenCalledOnce();
		expect(h.provider.names()).toEqual([
			"subscription_started",
			"subscription_updated",
			"subscription_canceled",
			"subscription_ended",
		]);
		expect(h.provider.find("subscription_started")).toMatchObject({
			userId,
			category: "billing",
			properties: {
				subscriptionId: "sub_row_1",
				plan: "pro",
				status: "active",
				interval: "month",
				trial: false,
				__emitkit_channel: "billing",
				__emitkit_notify: true,
			},
		});
		expect(h.provider.find("subscription_updated").properties.status).toBe(
			"past_due",
		);
	});

	it("reports an organization's subscription without a user id", async () => {
		const { subscription } = await setupStripe();
		const h = harness as Harness;

		await subscription.onSubscriptionComplete({
			subscription: {
				id: "sub_row_2",
				plan: "pro",
				status: "trialing",
				referenceId: "org_123",
				trialStart: new Date(),
			},
		});
		await h.flush();

		expect(h.provider.find("subscription_started")).toMatchObject({
			userId: undefined,
			properties: { organizationId: "org_123", trial: true },
		});
	});
});
