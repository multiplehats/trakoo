import { describe, expect, expectTypeOf, it } from "vitest";
import * as Analytics from "@/client/index";
import type {
	AnalyticsValidationError,
	EventInputMap,
	EventOutputMap,
	ValidationConfig,
} from "@/index";
import * as Trakoo from "@/index";

// @ts-expect-error CreateEventDefinition is no longer public
import type { CreateEventDefinition } from "@/index";
// @ts-expect-error EventCollection is no longer public
import type { EventCollection } from "@/index";
// @ts-expect-error ExtractEventNames is no longer public
import type { ExtractEventNames } from "@/index";
// @ts-expect-error ExtractEventPropertiesFromCollection is no longer public
import type { ExtractEventPropertiesFromCollection } from "@/index";
// @ts-expect-error EventMapFromCollection is no longer public
import type { EventMapFromCollection } from "@/index";
// @ts-expect-error EventDefinition is no longer public
import type { EventDefinition } from "@/index";
// @ts-expect-error ExtractEventName is no longer public
import type { ExtractEventName } from "@/index";
// @ts-expect-error ExtractEventProperties is no longer public
import type { ExtractEventProperties } from "@/index";
// @ts-expect-error applyValidationFailurePolicy is internal
import { applyValidationFailurePolicy as rootFailurePolicy } from "@/index";
// @ts-expect-error applyValidationFailurePolicy is internal
import { applyValidationFailurePolicy as clientFailurePolicy } from "@/client/index";

type PublicTypes =
	| AnalyticsValidationError
	| EventInputMap<never>
	| EventOutputMap<never>
	| ValidationConfig;

void (0 as unknown as PublicTypes);
void rootFailurePolicy;
void clientFailurePolicy;

describe("trakoo exports", () => {
	it("exports environment-neutral event helpers and validation errors", () => {
		expect(Trakoo.defineEvents).toBeDefined();
		expect(Trakoo.typed).toBeDefined();
		expect(Trakoo.noProperties).toBeDefined();
		expect(Trakoo.AnalyticsValidationError).toBeDefined();
		expect(Trakoo).not.toHaveProperty("applyValidationFailurePolicy");
		expectTypeOf<PublicTypes>().not.toBeNever();
	});

	it("should export only the registry-bound client factory", () => {
		expect(Analytics.createClientAnalytics).toBeDefined();
		expect(Analytics).not.toHaveProperty("createAnalytics");
		expect(Analytics).not.toHaveProperty("getAnalytics");
		expect(Analytics).not.toHaveProperty("track");
		expect(Analytics).not.toHaveProperty("identify");
		expect(Analytics).not.toHaveProperty("pageView");
		expect(Analytics).not.toHaveProperty("pageLeave");
		expect(Analytics).not.toHaveProperty("reset");
		expect(Analytics).not.toHaveProperty("flush");
	});

	it("should export provider classes (client only)", () => {
		expect(Analytics.BaseAnalyticsProvider).toBeDefined();
		expect(Analytics.PostHogClientProvider).toBeDefined();
	});

	it("should export analytics classes", () => {
		expect(Analytics.BrowserAnalytics).toBeDefined();
	});
});
