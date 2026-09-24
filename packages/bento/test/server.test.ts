import { BentoServerProvider } from "../src/server.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sdk } = vi.hoisted(() => ({
	sdk: { addSubscriber: vi.fn(), track: vi.fn() },
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
		sdk.addSubscriber.mockResolvedValue({});
		sdk.track.mockResolvedValue({});
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
		expect(sdk.addSubscriber).toHaveBeenCalledWith({
			email: "first@example.com",
			fields: { plan: "pro", email: undefined },
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
});
