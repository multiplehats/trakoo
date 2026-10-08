import { createServerAnalytics } from "trakoo/server";
import { defineEvents } from "trakoo";
import { BentoServerProvider } from "../src/server.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sdk } = vi.hoisted(() => ({
	sdk: { updateFields: vi.fn(), track: vi.fn(), trackPurchase: vi.fn() },
}));

vi.mock("@bentonow/bento-node-sdk", () => ({
	Analytics: class {
		V1 = sdk;
	},
}));

describe("BentoServerProvider", () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		for (const mock of Object.values(sdk)) mock.mockReset();
		sdk.updateFields.mockResolvedValue(true);
		sdk.track.mockResolvedValue(true);
		sdk.trackPurchase.mockResolvedValue(true);
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it("uses only identity supplied on each server call", async () => {
		const provider = new BentoServerProvider({
			siteUuid: "site-uuid",
			authentication: {
				publishableKey: "publishable-key",
				secretKey: "secret-key",
			},
		});
		await provider.initialize();

		await provider.identify("first@example.com", { plan: "pro" });
		expect(sdk.updateFields).toHaveBeenCalledWith({
			email: "first@example.com",
			fields: { plan: "pro" },
		});

		await provider.track({
			action: "anonymous_event",
			category: "engagement",
			properties: {},
		});
		expect(sdk.track).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledOnce();
		const eventWarning = warnSpy.mock.calls[0]?.[0] as string;
		expect(eventWarning).toContain(
			"current call's user context or event userId",
		);
		expect(eventWarning).not.toContain("call identify() with");

		await provider.track(
			{ action: "current_context", category: "engagement", properties: {} },
			{ user: { email: "second@example.com" } },
		);
		await provider.track({
			action: "event_identity",
			category: "engagement",
			userId: "event@example.com",
			properties: {},
		});
		expect(sdk.track).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				email: "second@example.com",
				type: "$current_context",
			}),
		);
		expect(sdk.track).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				email: "event@example.com",
				type: "$event_identity",
			}),
		);

		await provider.pageView();
		expect(sdk.track).toHaveBeenCalledTimes(2);
		const pageViewWarning = warnSpy.mock.calls[1]?.[0] as string;
		expect(pageViewWarning).toContain("current call's user context");
		expect(pageViewWarning).not.toContain("call identify() with");

		await provider.reset();
		await provider.track({
			action: "still_anonymous",
			category: "engagement",
			properties: {},
		});
		expect(sdk.track).toHaveBeenCalledTimes(2);
	});
	describe("revenue", () => {
		const createProvider = async () => {
			const provider = new BentoServerProvider({
				siteUuid: "site-uuid",
				authentication: {
					publishableKey: "publishable-key",
					secretKey: "secret-key",
				},
			});
			await provider.initialize();
			return provider;
		};

		it("tracks a purchase for the subscriber, deduplicated by its id", async () => {
			const provider = await createProvider();

			await provider.revenue(
				{
					amount: 4900,
					currency: "EUR",
					id: "in_123",
					userId: "user-a",
					properties: { planId: "pro" },
					timestamp: Date.parse("2026-10-08T09:30:00.000Z"),
				},
				{ user: { email: "payer@example.com" } },
			);

			expect(sdk.trackPurchase).toHaveBeenCalledWith({
				email: "payer@example.com",
				date: new Date("2026-10-08T09:30:00.000Z"),
				purchaseDetails: {
					unique: { key: "in_123" },
					value: { currency: "EUR", amount: 4900 },
				},
			});
		});

		it.each([
			["an email address", { currency: "EUR", id: "in_1" }, undefined],
			["a currency", { id: "in_1" }, { user: { email: "payer@example.com" } }],
			["an id", { currency: "EUR" }, { user: { email: "payer@example.com" } }],
		])("skips revenue without %s", async (missing, fields, context) => {
			const provider = await createProvider();

			await provider.revenue(
				{ amount: 100, userId: "user-a", timestamp: 0, ...fields },
				context,
			);

			expect(sdk.trackPurchase).not.toHaveBeenCalled();
			expect(warnSpy.mock.calls[0]?.[0]).toContain(missing);
		});
	});
	describe("revenue through server analytics", () => {
		const createAnalytics = () =>
			createServerAnalytics({
				events: defineEvents({}),
				providers: [
					new BentoServerProvider({
						siteUuid: "site-uuid",
						authentication: {
							publishableKey: "publishable-key",
							secretKey: "secret-key",
						},
					}),
				],
			});

		it("reads the payer's email from the call's user", async () => {
			await createAnalytics().revenue(4900, undefined, {
				currency: "EUR",
				id: "in_123",
				userId: "user-a",
				user: { email: "payer@example.com" },
			});

			expect(sdk.trackPurchase).toHaveBeenCalledWith(
				expect.objectContaining({ email: "payer@example.com" }),
			);
		});

		it("reads the email from a userId that is one", async () => {
			await createAnalytics().revenue(4900, undefined, {
				currency: "EUR",
				id: "in_123",
				userId: "payer@example.com",
			});

			expect(sdk.trackPurchase).toHaveBeenCalledWith(
				expect.objectContaining({ email: "payer@example.com" }),
			);
		});

		it.each([
			["is not queued", () => sdk.trackPurchase.mockResolvedValue(false)],
			[
				"throws",
				() => sdk.trackPurchase.mockRejectedValue(new Error("network")),
			],
		])("logs and resolves when Bento %s", async (_label, arrange) => {
			arrange();
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await expect(
				createAnalytics().revenue(4900, undefined, {
					currency: "EUR",
					id: "in_123",
					user: { email: "payer@example.com" },
				}),
			).resolves.toBeUndefined();

			expect(sdk.trackPurchase).toHaveBeenCalledOnce();
			errorSpy.mockRestore();
		});
	});
});
