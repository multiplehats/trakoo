# Events and Validation Reference

Use one shared runtime registry for browser and server analytics. The object keys organize source code; each definition's `name` is the emitted event name accepted by `track()` and sent to providers.

## Define events

Install only the chosen validator when runtime validation is needed. Trakoo does not require one:

```bash
npm install trakoo zod
```

```ts
import { defineEvents, noProperties, typed } from "trakoo";
import { z } from "zod";

export const appEvents = defineEvents({
	buttonClicked: {
		name: "button_clicked",
		category: "engagement",
		properties: typed<{
			buttonId: string;
			location?: "hero" | "pricing";
		}>(),
	},
	purchaseCompleted: {
		name: "purchase_completed",
		category: "conversion",
		properties: z.object({
			orderId: z.string(),
			amount: z.coerce.number().positive(),
			currency: z.string().length(3),
		}),
	},
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
	},
});
```

The three property modes are:

| Definition | Compile-time type | Runtime behavior |
|---|---|---|
| `typed<T>()` | Input and output are `T` | No runtime validation |
| Standard Schema validator | Inferred validator input and output | Validates and normalizes before routing |
| `noProperties()` | No properties argument | Normalizes omitted input to an empty provider object |

Recent compatible Zod, Valibot, ArkType, and other Standard Schema implementations work directly with no Trakoo adapter. Install only the chosen validator; do not add validator-specific Trakoo configuration. Trakoo itself remains validator-optional.

`typed<T>()` is for trusted, type-checked application values. It does not validate JavaScript, JSON, form data, or other untrusted input at runtime. Use a schema when that boundary needs validation. Duplicate emitted names are a registry initialization error.

## Schema input and provider output

A schema can accept one input shape and return a normalized provider output. In the example, Zod coercion accepts a numeric string and providers receive a number:

```ts
await analytics.track("purchase_completed", {
	orderId: "order_456",
	amount: "19.95",
	currency: "EUR",
});
```

Trakoo awaits the Standard Schema result, rejects invalid or non-object output under the configured policy, and routes the successful output—not the original input—to every selected provider. Transformations, coercion, stripping, and sanitization therefore happen once before routing.

## Propertyless calls

Client calls omit argument two:

```ts
await analytics.track("session_started");
```

For server analytics, server options go directly in argument two:

```ts
await serverAnalytics.track(
	"session_started",
	{
		userId: "user_123",
		user: {
			email: "ada@example.com",
			traits: { plan: "pro" },
		},
	},
);
```

`userId` belongs directly in server track options. Identity fields such as `email` stay top-level in `user`, while application traits belong under `user.traits`. Do not pass a raw custom-traits object as `user`.

Never pass an `undefined` properties placeholder. A client second argument, a server `undefined` placeholder, or properties supplied through untyped JavaScript is `invalid_properties` under the validation-failure policy.

## Factory inference and user traits

Both factories require the same registry value and infer the event map:

```ts
import { typed } from "trakoo";
import { createClientAnalytics } from "trakoo/client";
import { createServerAnalytics } from "trakoo/server";
import { appEvents } from "./events";

interface UserTraits {
	plan: "free" | "pro";
}

const analytics = createClientAnalytics({
	events: appEvents,
	userTraits: typed<UserTraits>(),
	providers: clientProviders,
});

const serverAnalytics = createServerAnalytics({
	events: appEvents,
	userTraits: typed<UserTraits>(),
	providers: serverProviders,
});
```

The optional `userTraits` marker types `identify()` and the `user.traits` member of server user context. It is type-only and is neither validated nor sent to providers as configuration. On the server, keep identity fields at the top level of `user` and wrap the typed application values inside `user.traits`, as shown above.

## Validation timing

Every `track()` variant returns `Promise<void>`. Validation finishes before provider routing begins, so a failed event is never partially delivered. Successful normalized output is shared by every selected provider.

Standard Schema validation may be asynchronous. Concurrent calls are not guaranteed to reach providers in call order; await calls sequentially when order matters. Provider delivery remains parallel and isolated after validation.

## Failure policy and security

`onFailure` defaults to `"drop"` on both client and server. Invalid events resolve without delivery so analytics validation does not fail a successful business operation. Strict tests or workflows can opt into rejection:

```ts
const analytics = createServerAnalytics({
	events: appEvents,
	providers: serverProviders,
	validation: {
		onFailure: "throw",
		onError(error) {
			reportValidationFailure({
				code: error.code,
				eventName: error.eventName,
				paths: error.issues.map((issue) => issue.path),
			});
		},
	},
});
```

`AnalyticsValidationError` reports the emitted event name, normalized issue information, and one of `unknown_event`, `invalid_properties`, `validator_failure`, or `invalid_output`. It never retains the submitted properties object or validator exception. Its normalized issues may include validator-provided messages, and those messages can contain application values.

When configured, `onError` receives the error exactly once. A throwing or rejected callback cannot change the selected drop/throw policy. Select and sanitize fields before forwarding a validation failure to application observability; the example sends only the code, event name, and normalized paths rather than the whole error.

Default debug logging exposes only sanitized metadata such as the code, event name, and normalized paths. It never logs raw messages or input.

This validation policy does not redefine provider-delivery or initialization errors. Those retain their existing behavior, so `track()` can still reject for reasons outside event validation.

## Verification

Run the application's type checker and production build. Add runtime tests for schema success, transformation, and rejection. Confirm invalid events do not reach any provider and normalized output reaches every routed provider.
