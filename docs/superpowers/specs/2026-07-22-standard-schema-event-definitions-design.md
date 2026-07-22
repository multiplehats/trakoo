# Standard Schema Event Definitions Design

**Date:** 2026-07-22
**Status:** Approved for specification review

## Goal

Replace trakoo's type-asserted event collections with a runtime event registry
based on the Standard Schema family. The new model must preserve trakoo's
compile-time event safety, optionally add runtime validation and transformation,
and remove the explicit generics and `as const satisfies` ceremony required by
the current API.

This is an intentionally breaking event-definition release. Client/server event
scoping will build on this foundation in a later release and is not part of this
work.

## Design Principles

- Use Standard Typed and Standard Schema as structural contracts rather than
  coupling trakoo to a validation library.
- Make runtime validation available but not mandatory.
- Keep every event's property shape in one source of truth.
- Infer event names and property types from runtime definitions without factory
  generics or exported type aliases.
- Validate once before provider routing and give every provider the same
  normalized output.
- Keep analytics resilient by dropping invalid events by default.
- Do not let validation, reporting, or default logs expose complete event
  payloads.

## Public Event API

The root `trakoo` entry point will export the environment-neutral runtime
helpers `defineEvents()` and `typed()`. It will continue to export the shared
event types. Importing these helpers must remain browser-safe and must not pull
in client providers, server providers, or any validation library.

### Schema-backed events

A Standard Schema-compatible value is used directly as the `properties`
definition:

```typescript
import { defineEvents } from "trakoo";
import { z } from "zod";

export const appEvents = defineEvents({
  purchaseCompleted: {
    name: "purchase_completed",
    category: "conversion",
    properties: z.object({
      orderId: z.string(),
      amount: z.number().positive(),
    }),
  },
});
```

The properties schema supplies both the input type accepted by `track()` and
the output type sent to providers. If a schema transforms or sanitizes its
input, providers receive the successful output and never the original input.

Trakoo integrates only with the Standard Schema interface. Recent compatible
versions of Zod, Valibot, ArkType, and other implementations require no trakoo
adapter or factory configuration.

### Type-only events

Users who do not want a validation library use `typed<T>()`:

```typescript
import { defineEvents, typed } from "trakoo";

export const appEvents = defineEvents({
  buttonClicked: {
    name: "button_clicked",
    category: "engagement",
    properties: typed<{
      buttonId: string;
      location: string;
    }>(),
  },
});
```

`typed<T>()` returns a small Standard Typed-compatible value whose input and
output types are both `T`. It does not implement `validate`, allocate a runtime
schema, or perform runtime validation. `T` must be an object property shape.

The single `typed<T>()` generic is the only explicit type annotation required
for type-only events. It is unavoidable because no concrete schema exists from
which TypeScript could infer the property shape.

### Registry behavior

`defineEvents()` accepts an object whose keys organize application source code.
The `name` field remains the emitted event name used by `track()` and analytics
providers.

`defineEvents()` must:

- preserve literal event names using const generic inference;
- require every `properties` value to satisfy Standard Typed;
- require inferred input and output values to be object property shapes;
- preserve category literals without `as const` or `satisfies` at the call site;
- build or retain enough runtime information for lookup by emitted name; and
- throw a clear initialization error when two definitions use the same emitted
  name.

The event category stored in the definition becomes the category on the
provider event. The adapters will no longer derive categories from event-name
prefixes.

## Analytics Factory API

Both factories require the runtime event registry and infer their event map
from it:

```typescript
import { createClientAnalytics } from "trakoo/client";

export const analytics = createClientAnalytics({
  events: appEvents,
  providers: [provider],
});
```

```typescript
import { createServerAnalytics } from "trakoo/server";

export const serverAnalytics = createServerAnalytics({
  events: appEvents,
  providers: [provider],
});
```

The event registry is required. The factories no longer accept an event
collection through an explicit generic, and typed instances do not fall back to
arbitrary event names.

Custom user traits also move out of factory generics so event inference is not
lost. Applications that type traits provide an optional Standard Typed marker:

```typescript
interface UserTraits {
  email: string;
  plan: "free" | "pro";
}

const analytics = createClientAnalytics({
  events: appEvents,
  userTraits: typed<UserTraits>(),
  providers: [provider],
});
```

The marker types `identify()` and server event user context but is not sent to
providers or used for runtime validation. When omitted, user traits retain the
existing open record default. This keeps both factory calls free of explicit
generics.

After inference, normal use contains no trakoo-specific generics:

```typescript
analytics.track("purchase_completed", {
  orderId: "order_123",
  amount: 49,
});
```

The event name determines the accepted property input. Misspelled names,
missing properties, and invalid property values remain compile-time errors.

## Tracking Data Flow

Every `track()` call follows the same core sequence on client and server:

1. Short-circuit immediately when analytics is disabled.
2. Look up the runtime definition by emitted event name.
3. Treat an unknown runtime name as an event-definition failure. This covers
   JavaScript callers and TypeScript callers that bypass types.
4. If the properties value implements Standard Schema, call
   `properties["~standard"].validate(input)` and await either its synchronous or
   asynchronous result.
5. If validation succeeds, require the returned value to be a non-null,
   non-array object.
6. Construct the base event using the definition's name, category, and validated
   output. A type-only definition uses the original input as its output.
7. Apply existing provider method and event routing.
8. Send the same normalized output to every selected provider.

Validation happens before any provider receives an event. A failed event is
never partially delivered. Existing provider isolation remains unchanged: one
provider's delivery failure must not prevent other providers from receiving a
valid event.

Because Standard Schema validators may be asynchronous, concurrent `track()`
calls are not guaranteed to reach providers in call order. This matches the
library's existing parallel, non-queued delivery model and must be documented.

## Validation Failure Policy

Client and server analytics share the same resilient default:

```typescript
const analytics = createClientAnalytics({
  events: appEvents,
  providers: [provider],
  validation: {
    onFailure: "drop",
    onError(error) {
      // Send sanitized metadata to application observability.
    },
  },
});
```

The public configuration is:

```typescript
interface ValidationConfig {
  onFailure?: "drop" | "throw";
  onError?: (error: AnalyticsValidationError) => void;
}
```

`onFailure` defaults to `"drop"` on both client and server. This is consistent
with trakoo's resilience contract and avoids turning a successful business
operation into a failed or retried request because its analytics payload was
invalid.

Strict behavior is opt-in for tests and workflows that explicitly want it:

```typescript
const analytics = createServerAnalytics({
  events: appEvents,
  providers: [provider],
  validation: { onFailure: "throw" },
});
```

For every event-definition or validation failure:

1. Construct an `AnalyticsValidationError` without retaining the input payload.
2. Invoke `onError` exactly once when configured.
3. Ignore a returned value from `onError`. If the callback throws or returns a
   rejected thenable, contain that failure so reporting cannot change the
   configured tracking policy.
4. Under `"drop"`, resolve `track()` without routing the event.
5. Under `"throw"`, reject `track()` with the validation error after the
   callback has been invoked.

When `onError` is absent, production mode is silent. In debug mode, trakoo may
log only sanitized metadata such as the error code, event name, and normalized
paths. It must not log the input payload or raw vendor issue messages because a
custom validator message may contain application values.

This policy governs event-definition and validation failures only. This release
does not broaden or redefine the existing initialization and provider-delivery
error contracts, and documentation must not imply that `track()` can never
reject for reasons outside this policy.

## Validation Errors

`AnalyticsValidationError` gives applications a stable, validator-independent
shape. It includes:

- the emitted event name;
- a machine-readable code distinguishing `unknown_event`,
  `invalid_properties`, `validator_failure`, and `invalid_output`; and
- normalized Standard Schema issue paths and messages when validation returned
  issues.

The error never stores the submitted properties object. Path normalization must
handle string, number, symbol, and Standard Schema path-segment objects without
throwing. A validator that throws synchronously or rejects asynchronously is a
`validator_failure`, distinct from an ordinary validation result containing
issues.

`typed<T>()` definitions never enter schema validation. Their inputs can still
fail runtime registry checks such as an unknown event name, but trakoo cannot
validate their property values.

## Standard Schema Packaging

Use `@standard-schema/spec` as the canonical source of public Standard Typed and
Standard Schema TypeScript contracts. Imports from that package must be
type-only so no schema implementation is added to trakoo's runtime bundle.

Users do not need Zod, Valibot, or another validator unless they choose runtime
validation. These packages must not become trakoo dependencies or peer
dependencies.

Do not ship first-party Zod, Valibot, or ArkType adapters. Standard-compatible
versions work structurally. Adapters for older or non-standard validators may
be considered later as separate compatibility packages if real demand appears.

## Developer Experience Requirements

The schema-backed happy path must require:

- no `as const`;
- no `satisfies EventCollection<...>`;
- no `typeof appEvents` factory generic;
- no exported `AppEvents` type alias;
- no manually repeated schema input or output type; and
- no trakoo-specific validator adapter.

Type-only events write their property shape exactly once inside `typed<T>()`.
Custom user traits, when used, write their shape exactly once inside the
optional `userTraits: typed<T>()` marker. Neither client nor server factory
requires explicit generic arguments.

Public declarations and TypeScript diagnostics should expose small named helper
types instead of deeply nested conditional or mapped types wherever possible.
Internal type machinery must not leak into routine autocomplete or error
messages.

The root runtime helpers must be small and environment-neutral so importing
event definitions remains safe in browser, Node, and edge bundles.

## Breaking Migration

The release replaces:

```typescript
export const appEvents = {
  buttonClicked: {
    name: "button_clicked",
    category: "engagement",
    properties: {} as { buttonId: string },
  },
} as const satisfies EventCollection<
  Record<string, CreateEventDefinition<string>>
>;

const analytics = createClientAnalytics<typeof appEvents>({ providers });
```

with:

```typescript
export const appEvents = defineEvents({
  buttonClicked: {
    name: "button_clicked",
    category: "engagement",
    properties: typed<{ buttonId: string }>(),
  },
});

const analytics = createClientAnalytics({
  events: appEvents,
  providers,
});
```

The obsolete `CreateEventDefinition`, `EventCollection`, extraction helpers,
and generic-only factory signatures should be removed rather than maintaining
two competing definition systems. Shared low-level event/provider types that
remain useful are retained.

All README examples, core-concept pages, provider guides, and framework guides
must migrate together. A focused migration page will show type-only and
schema-backed conversions side by side and explain the default validation
failure policy.

## Verification Strategy

### Type-level coverage

- Literal names and categories survive `defineEvents()` without `as const`.
- Schema input types drive `track()` arguments.
- Schema output types drive the internal provider event properties.
- Schema transformations require no manual input/output annotations.
- Type-only definitions infer `T` for both input and output.
- Unknown names and incorrect properties fail typechecking on both client and
  server.
- Factory calls require no event generic.
- Optional user-trait markers type client identification and server user
  context without factory generics.
- Representative invalid calls produce short, actionable diagnostics.
- Built declaration files do not require a concrete validator package.

### Runtime coverage

- Type-only events bypass validation and reach providers unchanged.
- Synchronous and asynchronous validators succeed.
- Transformed or stripped outputs, rather than original inputs, reach every
  provider.
- Returned validation issues, thrown validators, and rejected validators map to
  the correct error codes.
- Drop is the default on client and server; throw is opt-in.
- `onError` runs exactly once and cannot alter the configured policy.
- Default debug logging is sanitized.
- Duplicate emitted names fail clearly.
- Unknown runtime names follow the configured failure policy.
- Primitive, null, and array outputs fail as `invalid_output`.
- Disabled analytics bypasses lookup, validation, callbacks, and delivery.
- Provider routing and per-provider failure isolation continue to work after
  validation.

At least one integration test will use a real Standard Schema-compatible
library. Contract-level tests will use small local Standard Typed and Standard
Schema fixtures so the core suite does not depend on vendor-specific APIs.

### Package and documentation coverage

- Build all public entry points and inspect their declarations.
- Confirm root event helpers remain environment-neutral.
- Confirm installing trakoo does not install or require a concrete validation
  library.
- Update all source and documentation examples in the repository.
- Add a migration guide and link it from the changelog/release notes.

## Explicit Non-Goals

- Client-only, server-only, or shared event annotations.
- Runtime enforcement of event environments.
- JSON Schema generation or schema introspection beyond Standard validation.
- Generated analytics documentation.
- A trakoo-owned validation DSL or schema AST.
- First-party adapters for already Standard-compatible libraries.
- Compatibility shims for the old event collection API.
- Changes to provider-specific serialization beyond consuming validated output.
- Redefining initialization or provider-delivery failure behavior.
