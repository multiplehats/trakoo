/** @vitest-environment jsdom */
import { OpenPanelClientProvider } from "@/providers/openpanel/client.js";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("OpenPanelClientProvider with the web SDK", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("preserves the context path when tracking before a page view", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			status: 202,
			text: vi.fn().mockResolvedValue(""),
		});
		vi.stubGlobal("fetch", fetchMock);

		const provider = new OpenPanelClientProvider({ clientId: "client-id" });
		await provider.initialize();
		await provider.track(
			{ action: "checkout_started", category: "conversion" },
			{ page: { path: "/checkout" } },
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(request.body));
		expect(body.payload.properties.__path).toBe("/checkout");
	});
});
