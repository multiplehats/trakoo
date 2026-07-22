# Standard Schema Event Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace trakoo's phantom event types with a required runtime event registry that accepts Standard Schema validators directly, retains a validator-free type-only path, and infers client/server tracking without event generics.

**Architecture:** `defineEvents()` augments a literal definition object with a private emitted-name registry, while `typed<T>()` and `noProperties()` provide branded Standard Typed markers. Named input/output maps drive `track()`; a shared resolver normalizes schema output or applies drop/throw before either adapter routes an event.

**Tech Stack:** TypeScript 5.5, `@standard-schema/spec` 1.1, Zod 4 integration fixture, Vitest 2, Vite 6, vite-plugin-dts, pnpm 9, Biome, Blume

## Global Constraints

- `events` is required by both factories; there is no arbitrary-event fallback.
- Schema users need no trakoo generics, `as const`, `satisfies`, type aliases, or validator adapters.
- Type-only shapes appear once in `typed<T>()`; propertyless events use `noProperties()`.
- `typed<T>()` accepts ordinary interfaces and rejects primitives, arrays, and functions without requiring an index signature.
- Standard Schema input drives `track()` and successful output reaches every provider.
- `track()` always returns `Promise<void>`; delivery starts after validation.
- Validation defaults to `drop` everywhere; `throw` is opt-in.
- Errors and default logs never retain or emit the complete input payload.
- `@standard-schema/spec` is a regular dependency via type-only imports; Zod is development-only.
- Client instances are fresh and registry-bound; remove the singleton and untyped convenience functions.
- Event environment scoping, JSON Schema, generated docs, and validator-specific adapters are out of scope.
- Preserve provider routing, context enrichment, failure isolation, and serialization.

---

## File Map

- `src/core/events/schema.ts`: branded markers, Standard guards, inference helpers.
- `src/core/events/registry.ts`: definitions, `defineEvents()`, lookup, duplicate detection, input/output maps.
- `src/core/events/validation.ts`: config, normalized errors, validation, drop/throw handling.
- `src/adapters/client/browser-analytics.ts`, `src/client.ts`: registry-bound client API.
- `src/adapters/server/server-analytics.ts`, `src/server.ts`: registry-bound server API.
- `src/providers/proxy/server.ts`: raw proxy replay through runtime registry validation.
- `src/{index,client/index,server/index}.ts`: final public exports.
- `test/events.test.ts`, `test/event-validation.test.ts`: core contract tests.
- `test/{client-analytics,server-analytics,provider-routing,proxy-server}.test.ts`: integration migration.
- `test/standard-schema-integration.test.ts`: real Zod inference/transformation.
- `scripts/verify-package.mjs`: clean packed-consumer verification.
- `readme.md`, `www/content/docs/**/*.mdx`: complete API/documentation migration.
- `.changeset/standard-schema-events.md`: breaking release metadata.

---

### Task 1: Standard Typed Markers and Runtime Registry

**Files:**
- Create: `src/core/events/schema.ts`
- Create: `src/core/events/registry.ts`
- Modify: `src/core/events/index.ts`
- Replace: `test/events.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `EventCategory`; Standard Typed/Schema v1.
- Produces: `TypeMarker<T>`, `NoPropertiesMarker`, `typed()`, `noProperties()`, `InferMarker<T>`, `defineEvents()`, `EventRegistry<T>`, `EventName<R>`, `EventInputMap<R>`, `EventOutputMap<R>`, client/server track tuple types.

- [ ] **Step 1: Add dependencies**

```bash
pnpm add @standard-schema/spec@^1.1.0
pnpm add -D zod@^4.4.3
```

Expected: Standard Schema is in `dependencies`; Zod is in `devDependencies`.

- [ ] **Step 2: Write failing core tests**

Replace `test/events.test.ts` with tests based on:

```typescript
interface ClickProperties { buttonId: string; location?: string }

const events = defineEvents({
	buttonClicked: {
		name: "button_clicked",
		category: "engagement",
		properties: typed<ClickProperties>(),
	},
	sessionStarted: {
		name: "session_started",
		category: "user",
		properties: noProperties(),
	},
});

expectTypeOf<EventName<typeof events>>()
	.toEqualTypeOf<"button_clicked" | "session_started">();
expectTypeOf<EventInputMap<typeof events>["button_clicked"]>()
	.toEqualTypeOf<ClickProperties>();
expectTypeOf<EventOutputMap<typeof events>["button_clicked"]>()
	.toEqualTypeOf<ClickProperties>();
expectTypeOf<EventInputMap<typeof events>["session_started"]>()
	.toEqualTypeOf<undefined>();

// @ts-expect-error primitive
typed<string>();
// @ts-expect-error array
typed<string[]>();
// @ts-expect-error function
typed<() => void>();
```

Add runtime tests that duplicate emitted names throw `/duplicate event name/i`
and the private registry metadata is non-enumerable.

- [ ] **Step 3: Confirm failure**

```bash
pnpm vitest run test/events.test.ts
pnpm typecheck
```

Expected: FAIL because the new helpers do not exist.

- [ ] **Step 4: Implement `schema.ts`**

Use these public contracts:

```typescript
import type { StandardSchemaV1, StandardTypedV1 } from "@standard-schema/spec";

declare const typeMarkerBrand: unique symbol;
declare const noPropertiesBrand: unique symbol;

export type PropertyObject<T> = T extends readonly unknown[]
	? never
	: T extends (...args: never[]) => unknown
		? never
		: T extends object ? T : never;

type InvalidPropertyArguments<T> = PropertyObject<T> extends never
	? [error: "typed<T>() requires a non-array, non-callable object shape"]
	: [];

export interface TypeMarker<T extends object> extends StandardTypedV1<T, T> {
	readonly kind: "type";
	readonly [typeMarkerBrand]: T;
}

export interface NoPropertiesMarker
	extends StandardTypedV1<undefined, Record<never, never>> {
	readonly kind: "none";
	readonly [noPropertiesBrand]: true;
}

export function typed<T extends object>(
	...invalid: InvalidPropertyArguments<T>
): TypeMarker<T>;
export function noProperties(): NoPropertiesMarker;

export type InferMarker<T> = T extends TypeMarker<infer TValue>
	? TValue
	: Record<string, unknown>;

export type EventProperties =
	| TypeMarker<object>
	| NoPropertiesMarker
	| StandardSchemaV1<object, object>;
```

Return frozen marker objects containing
`"~standard": { version: 1, vendor: "trakoo" }` and no `validate`. Add
`isTypeMarker`, `isNoPropertiesMarker`, and `isStandardSchema` guards. The
private brand is compile-time-only; `kind` is the runtime discriminator.

- [ ] **Step 5: Implement `registry.ts`**

Use an augmented literal object, not a wrapper:

```typescript
export interface RuntimeEventDefinition<
	TName extends string = string,
	TProperties extends EventProperties = EventProperties,
> {
	readonly name: TName;
	readonly category: EventCategory;
	readonly properties: TProperties;
}

export type EventDefinitions = Record<string, RuntimeEventDefinition>;
const registryBrand: unique symbol = Symbol("trakoo.eventRegistry");
export type EventRegistry<T extends EventDefinitions> = T & {
	readonly [registryBrand]: ReadonlyMap<string, RuntimeEventDefinition>;
};

export function defineEvents<const T extends EventDefinitions>(
	definitions: T,
): EventRegistry<T>;
```

Build a name map, throw on duplicates, and attach it with
`Object.defineProperty` using `enumerable: false` and `writable: false`. Export
`getEventDefinition()` for internal runtime lookup.

Add compile-time fixtures proving that Standard Schema definitions whose input
or output is a primitive, array, or function are rejected by `defineEvents()`.

Build `EventInputMap`/`EventOutputMap` using
`StandardTypedV1.InferInput/InferOutput`, keyed by emitted `name`. Map
`NoPropertiesMarker` to input `undefined` and output `Record<never, never>`.
Use these intermediate types so the registry's private symbol never leaks into
the event-definition union:

```typescript
type RegistryDefinitions<R extends EventRegistry<EventDefinitions>> =
	R extends EventRegistry<infer T> ? T : never;
type EventDefinitionOf<R extends EventRegistry<EventDefinitions>> = RegistryDefinitions<R>[
	keyof RegistryDefinitions<R>
];

export type EventName<R extends EventRegistry<EventDefinitions>> =
	EventDefinitionOf<R>["name"];
type DefinitionForName<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
> = Extract<EventDefinitionOf<R>, { name: N }>;
type PropertiesForName<
	R extends EventRegistry<EventDefinitions>,
	N extends EventName<R>,
> = DefinitionForName<R, N>["properties"];

type InputFor<TProperties extends EventProperties> =
	TProperties extends NoPropertiesMarker
		? undefined
		: StandardTypedV1.InferInput<TProperties>;
type OutputFor<TProperties extends EventProperties> =
	TProperties extends NoPropertiesMarker
		? Record<never, never>
		: StandardTypedV1.InferOutput<TProperties>;

export type EventInputMap<R extends EventRegistry<EventDefinitions>> = {
	[N in EventName<R>]: InputFor<PropertiesForName<R, N>>;
};

export type EventOutputMap<R extends EventRegistry<EventDefinitions>> = {
	[N in EventName<R>]: OutputFor<PropertiesForName<R, N>>;
};
```

Then define readable exported tuple helpers:

```typescript
type ClientTrackArgs<R, N> = EventInputMap<R>[N] extends undefined
	? [eventName: N]
	: [eventName: N, properties: EventInputMap<R>[N]];

type ServerTrackArgs<R, N, O> = EventInputMap<R>[N] extends undefined
	? [eventName: N] | [eventName: N, properties: undefined, options: O]
	: [eventName: N, properties: EventInputMap<R>[N], options?: O];
```

- [ ] **Step 6: Export and verify core registry**

Export new APIs from `src/core/events/index.ts`, temporarily retaining legacy
helpers until Task 5.

```bash
pnpm vitest run test/events.test.ts
pnpm typecheck
pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/core/events/schema.ts src/core/events/registry.ts src/core/events/index.ts test/events.test.ts
git commit -m "feat: add Standard Schema event registry"
```

---

### Task 2: Shared Validation and Failure Policy

**Files:**
- Create: `src/core/events/validation.ts`
- Create: `test/event-validation.test.ts`
- Modify: `src/core/events/index.ts`

**Interfaces:**
- Consumes: registry lookup and marker guards.
- Produces: `ValidationConfig`, `AnalyticsValidationError`, `ResolvedEvent`, `resolveEvent()`.

- [ ] **Step 1: Write failing validation tests**

Use local Standard Schema fixtures with these validate results:

```typescript
const success = { value: { amount: 49 } };
const failure = { issues: [{ message: "invalid", path: ["amount"] }] };
const asyncSuccess = Promise.resolve({ value: { amount: 49 } });
```

Cover sync/async success, transforms, returned issues, thrown/rejected
validators, primitive/null/array output, unknown names, type-marker top-level
object checks, propertyless normalization/rejection, default drop, opt-in throw,
`onError` exactly once, throwing/rejected callbacks, sanitized debug logging,
and absence of input/payload fields on errors. Use a deferred async validator to
prove resolution does not occur before validation finishes.

- [ ] **Step 2: Confirm failure**

```bash
pnpm vitest run test/event-validation.test.ts
```

Expected: FAIL because validation exports do not exist.

- [ ] **Step 3: Implement error contracts**

```typescript
export type AnalyticsValidationErrorCode =
	| "unknown_event"
	| "invalid_properties"
	| "validator_failure"
	| "invalid_output";

export interface ValidationConfig {
	readonly onFailure?: "drop" | "throw";
	readonly onError?: (error: AnalyticsValidationError) => void;
}

export class AnalyticsValidationError extends Error {
	readonly name = "AnalyticsValidationError";
	constructor(
		readonly code: AnalyticsValidationErrorCode,
		readonly eventName: string,
		readonly issues: readonly NormalizedValidationIssue[] = [],
	) {
		super(`Analytics event ${eventName} failed: ${code}`);
	}
}
```

Normalize paths safely, including symbols and `{ key }` segments. Do not store
the validator exception as `cause` because it may retain input.

- [ ] **Step 4: Implement `resolveEvent()`**

```typescript
export interface ResolvedEvent {
	readonly name: string;
	readonly category: EventCategory;
	readonly properties: Record<string, unknown>;
}

export async function resolveEvent(
	registry: EventRegistry<EventDefinitions>,
	eventName: string,
	input: unknown,
	validation: ValidationConfig | undefined,
	debug: boolean,
): Promise<ResolvedEvent | undefined>;
```

Lookup, handle propertyless/type/schema definitions, await validation, and
accept only non-null non-array object output. Invoke `onError` once; contain
sync throws and rejected thenables; return `undefined` for drop or throw the
normalized error for strict mode. Debug fallback logs only `{ code, eventName,
paths }`, never raw messages or input.

- [ ] **Step 5: Export, verify, and commit**

```bash
pnpm vitest run test/event-validation.test.ts test/events.test.ts
pnpm typecheck
pnpm lint
git add src/core/events/validation.ts src/core/events/index.ts test/event-validation.test.ts
git commit -m "feat: validate Standard Schema event properties"
```

Expected: all commands PASS before commit.

---

### Task 3: Registry-Bound Client Analytics

**Files:**
- Modify: `src/core/events/types.ts`
- Modify: `src/adapters/client/browser-analytics.ts`
- Replace: `src/client.ts`
- Modify: `src/client/index.ts`
- Modify: `test/client-analytics.test.ts`, `test/client.test.ts`
- Modify: client sections of `test/provider-routing.test.ts`

**Interfaces:**
- Consumes: registry maps/tuples, `TypeMarker`, marker inference, `resolveEvent()`.
- Produces: inferred `ClientAnalyticsConfig<R, M>`, fresh `BrowserAnalytics<R, Traits>`, strict `track()`.

- [ ] **Step 1: Migrate client tests before implementation**

Define registries with `defineEvents()` and pass `events` to every client
factory. Include `page_viewed`, `button_clicked`, `test_event`, reset-related
propertyless events, and all client routing names. Remove singleton reset calls.
Add assertions for fresh instances, definition categories, transformed output,
disabled short-circuit, drop/throw, propertyless calls, and inferred traits.
Use `@ts-expect-error` for unknown names, missing/extra properties, and a second
argument on a propertyless event. Route a transformed event to two providers and
assert both receive the same normalized output. Verify a disabled invalid event
bypasses lookup, `onError`, and provider delivery.

Update `test/client.test.ts` to assert singleton helpers and the
`createAnalytics` alias are absent.

- [ ] **Step 2: Confirm failure**

```bash
pnpm vitest run test/client-analytics.test.ts test/client.test.ts test/provider-routing.test.ts
pnpm typecheck
```

Expected: FAIL on missing `events` support and stale singleton exports.

- [ ] **Step 3: Widen user-trait constraints correctly**

Change `UserContext<TTraits>` and `EventContext<TTraits>` constraints from
`Record<string, unknown>` to `object`, retaining the record default. Cast only
when passing traits or ordinary-interface event properties to the provider
transport API.

- [ ] **Step 4: Refactor `BrowserAnalytics`**

```typescript
export class BrowserAnalytics<
	TRegistry extends EventRegistry<EventDefinitions>,
	TUserTraits extends object = Record<string, unknown>,
> {
	async track<TName extends EventName<TRegistry>>(
		...args: ClientTrackArgs<TRegistry, TName>
	): Promise<void>;
}
```

Store registry, validation config, debug, and `enabled !== false`. Short-circuit
before initialization when disabled; call `resolveEvent`; return on drop; build
`BaseEvent` from resolved name/category/properties. Remove category derivation.
Preserve browser/session context and provider routing.

- [ ] **Step 5: Replace the client factory and exports**

```typescript
export interface ClientAnalyticsConfig<R, M = undefined> {
	readonly events: R;
	readonly userTraits?: M;
	readonly providers?: ProviderConfigOrProvider[];
	readonly validation?: ValidationConfig;
	readonly debug?: boolean;
	readonly enabled?: boolean;
}
```

Constrain `R` to an event registry and `M` to `TypeMarker<object> | undefined`
in the real declaration. Infer `InferMarker<M>` in the return type. Always
default `providers` to an empty array and return a fresh initialized
`BrowserAnalytics`. Remove singleton state, getter, reset hook, alias, and
module-level track/identify/page/reset/flush functions.

- [ ] **Step 6: Verify and commit**

```bash
pnpm vitest run test/client-analytics.test.ts test/client.test.ts test/provider-routing.test.ts
pnpm typecheck
pnpm lint
git add src/core/events/types.ts src/adapters/client/browser-analytics.ts src/client.ts src/client/index.ts test/client-analytics.test.ts test/client.test.ts test/provider-routing.test.ts
git commit -m "feat: bind client analytics to event registries"
```

Expected: client tests and typecheck PASS before commit.

---

### Task 4: Registry-Bound Server Analytics and Proxy Replay

**Files:**
- Modify: `src/adapters/server/server-analytics.ts`
- Modify: `src/server.ts`, `src/server/index.ts`
- Modify: `src/providers/proxy/server.ts`
- Modify: `test/server-analytics.test.ts`, `test/server.test.ts`
- Modify: `test/proxy-server.test.ts`
- Modify: server sections of `test/provider-routing.test.ts`

**Interfaces:**
- Consumes: registry maps/tuples, marker inference, `resolveEvent()`.
- Produces: `ServerAnalyticsConfig<R, M>`, `ServerTrackOptions<T>`, strict server tracking, validated raw proxy replay.

- [ ] **Step 1: Migrate server/proxy tests first**

Replace phantom definitions with `defineEvents()` and add `events` to every
server factory. Cover strict unknown names/properties, definition categories,
schema transformations, disabled mode, drop/throw, and these propertyless forms:

```typescript
await analytics.track("session_started");
await analytics.track("session_started", undefined, { userId: "user_123" });
// @ts-expect-error properties are forbidden
await analytics.track("session_started", { unexpected: true });
```

Add the routing registry to all server sections of
`test/provider-routing.test.ts`. Give proxy tests a registry containing each
replayed track name and assert an unknown raw name follows validation policy.

- [ ] **Step 2: Confirm failure**

```bash
pnpm vitest run test/server-analytics.test.ts test/server.test.ts test/proxy-server.test.ts test/provider-routing.test.ts
pnpm typecheck
```

Expected: FAIL because server/proxy types still use the event-map API.

- [ ] **Step 3: Refactor `ServerAnalytics`**

```typescript
export interface ServerTrackOptions<TUserTraits extends object> {
	readonly userId?: string;
	readonly sessionId?: string;
	readonly context?: EventContext<TUserTraits>;
	readonly user?: UserContext<TUserTraits>;
}

export class ServerAnalytics<
	TRegistry extends EventRegistry<EventDefinitions>,
	TUserTraits extends object = Record<string, unknown>,
> {
	async track<TName extends EventName<TRegistry>>(
		...args: ServerTrackArgs<
			TRegistry,
			TName,
			ServerTrackOptions<TUserTraits>
		>
	): Promise<void>;
}
```

Store registry/validation/debug/enabled. Short-circuit when disabled, retain the
initialized check, resolve before context construction, use definition category,
and remove category derivation. Widen ordinary-interface output only where the
shared provider transport requires `Record<string, unknown>`. For propertyless
events, only omitted or `undefined` properties are valid; options occupy
argument three.

- [ ] **Step 4: Replace server factory inference**

Mirror the client config with required registry and optional branded
`userTraits`. Infer registry and `InferMarker<M>` without explicit factory
generics, default `providers` to an empty array, create a fresh instance, and
initialize it as today.

- [ ] **Step 5: Adapt proxy replay at its JSON boundary**

Parameterize proxy ingestion by registry. Keep the public `track()` strict and
cast only raw JSON arguments:

```typescript
await analytics.track(
	event.event.action as EventName<TRegistry>,
	event.event.properties as never,
	{
		userId: event.event.userId,
		sessionId: event.event.sessionId,
		context: enrichedContext,
	},
);
```

Do not add an untyped public tracking method; runtime lookup/validation must
still reject or drop unknown proxy events.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test
pnpm typecheck
pnpm lint
git add src/adapters/server/server-analytics.ts src/server.ts src/server/index.ts src/providers/proxy/server.ts test/server-analytics.test.ts test/server.test.ts test/proxy-server.test.ts test/provider-routing.test.ts
git commit -m "feat: bind server analytics to event registries"
```

Expected: all code tests, typecheck, and lint PASS before commit.

---

### Task 5: Final Public API, Zod Integration, and Packed Consumer

**Files:**
- Modify: `src/core/events/index.ts`, `src/core/events/types.ts`
- Modify: `src/index.ts`, `src/client/index.ts`, `src/server/index.ts`
- Modify: `test/client.test.ts`, `test/server.test.ts`
- Create: `test/standard-schema-integration.test.ts`
- Create: `scripts/verify-package.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: completed registry-bound adapters.
- Produces: final breaking exports, direct Zod proof, packed-consumer verification.

- [ ] **Step 1: Write failing Zod and export tests**

Create a direct integration with no adapter:

```typescript
const events = defineEvents({
	purchaseCompleted: {
		name: "purchase_completed",
		category: "conversion",
		properties: z.object({
			orderId: z.string(),
			amount: z.string().transform(Number),
		}),
	},
});

expectTypeOf<EventInputMap<typeof events>["purchase_completed"]>()
	.toEqualTypeOf<{ orderId: string; amount: string }>();
expectTypeOf<EventOutputMap<typeof events>["purchase_completed"]>()
	.toEqualTypeOf<{ orderId: string; amount: number }>();
```

Track `{ orderId: "order_1", amount: "49" }` through a server mock and expect
provider properties `{ orderId: "order_1", amount: 49 }`. Export tests assert
root helpers/error are present and old event helpers/client singleton functions
are absent.

- [ ] **Step 2: Confirm stale public API failure**

```bash
pnpm vitest run test/standard-schema-integration.test.ts test/client.test.ts test/server.test.ts
pnpm build
```

Expected: export checks/build FAIL while legacy declarations remain.

- [ ] **Step 3: Remove all competing APIs**

Delete declarations and exports for:

```text
CreateEventDefinition
EventCollection
ExtractEventNames
ExtractEventPropertiesFromCollection
EventMapFromCollection
EventDefinition
ExtractEventName
ExtractEventProperties
AnyEventName
AnyEventProperties
```

Retain transport/provider types. Export `defineEvents`, `typed`,
`noProperties`, maps, configs, and `AnalyticsValidationError` from appropriate
entry points. Root runtime imports must remain environment-neutral.

- [ ] **Step 4: Add packed-consumer verification**

Add `"verify:package": "node scripts/verify-package.mjs"` to `package.json`.
Implement `scripts/verify-package.mjs` with this complete flow:

```javascript
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contextDirectory = join(root, ".context");
mkdirSync(contextDirectory, { recursive: true });
const consumerDirectory = mkdtempSync(
	join(contextDirectory, "package-consumer-"),
);
let tarballPath;

const run = (command, args, cwd = root) =>
	execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });

const consumerSource = String.raw`
import { defineEvents, noProperties, typed } from "trakoo";
import { createClientAnalytics } from "trakoo/client";

const events = defineEvents({
	clicked: {
		name: "clicked",
		category: "engagement",
		properties: typed<{ id: string }>(),
	},
	started: {
		name: "started",
		category: "user",
		properties: noProperties(),
	},
});

const analytics = createClientAnalytics({ events, providers: [] });
analytics.track("clicked", { id: "cta" });
analytics.track("started");
`;

try {
	run("pnpm", ["build"]);
	const packResult = JSON.parse(run("npm", ["pack", "--json"]));
	tarballPath = resolve(root, packResult[0].filename);

	run("npm", ["init", "-y"], consumerDirectory);
	run(
		"npm",
		["install", "--ignore-scripts", tarballPath],
		consumerDirectory,
	);

	writeFileSync(join(consumerDirectory, "consumer.ts"), consumerSource);
	writeFileSync(
		join(consumerDirectory, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					strict: true,
					noEmit: true,
					target: "ES2022",
					module: "ESNext",
					moduleResolution: "Bundler",
				},
				include: ["consumer.ts"],
			},
			null,
			2,
		),
	);
	run(
		process.execPath,
		[
			resolve(root, "node_modules/typescript/bin/tsc"),
			"--project",
			join(consumerDirectory, "tsconfig.json"),
		],
		consumerDirectory,
	);

	const installedManifest = JSON.parse(
		readFileSync(
			join(consumerDirectory, "node_modules/trakoo/package.json"),
			"utf8",
		),
	);
	if (!installedManifest.dependencies?.["@standard-schema/spec"]) {
		throw new Error("packed trakoo is missing @standard-schema/spec dependency");
	}
} finally {
	if (tarballPath) rmSync(tarballPath, { force: true });
	rmSync(consumerDirectory, { recursive: true, force: true });
}
```

Do not install Zod in this fixture; it verifies the validator-free package path.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:package
git add package.json src/core/events/index.ts src/core/events/types.ts src/index.ts src/client/index.ts src/server/index.ts test/client.test.ts test/server.test.ts test/standard-schema-integration.test.ts scripts/verify-package.mjs
git commit -m "feat: publish the Standard Schema event API"
```

Expected: every command PASS before commit; no concrete validator import exists
in `dist`.

---

### Task 6: README and Core Documentation

**Files:**
- Modify: `readme.md`
- Modify: `www/content/docs/(Getting Started)/index.mdx`
- Modify: `www/content/docs/(Getting Started)/installation.mdx`
- Modify: `www/content/docs/(Getting Started)/quick-start.mdx`
- Modify: `www/content/docs/core-concepts/client-vs-server.mdx`
- Modify: `www/content/docs/core-concepts/events.mdx`
- Modify: `www/content/docs/core-concepts/identifying-users.mdx`
- Modify: `www/content/docs/core-concepts/index.mdx`
- Modify: `www/content/docs/core-concepts/providers.mdx`
- Modify: `www/content/docs/core-concepts/type-safety.mdx`

**Interfaces:**
- Consumes: final API/failure behavior.
- Produces: canonical type-only, schema-backed, propertyless, factory, trait, and failure documentation.

- [ ] **Step 1: Record failing legacy checks**

```bash
rg -n 'CreateEventDefinition|EventCollection|as const satisfies|properties: \{\} as|create(Client|Server)Analytics<' readme.md www/content/docs/'(Getting Started)' www/content/docs/core-concepts
```

Expected: output identifies every legacy example.

- [ ] **Step 2: Replace definition examples**

Use this lightweight canonical form:

```typescript
export const appEvents = defineEvents({
  buttonClicked: {
    name: "button_clicked",
    category: "engagement",
    properties: typed<{ buttonId: string; location: string }>(),
  },
  sessionStarted: {
    name: "session_started",
    category: "user",
    properties: noProperties(),
  },
});
```

Use direct Zod only where validation is being taught:

```typescript
properties: z.object({
  orderId: z.string(),
  amount: z.coerce.number().positive(),
})
```

Explain input versus provider output and that Standard Schema is an interface,
not a required validator.

- [ ] **Step 3: Replace factory, trait, and failure examples**

Every factory receives `events: appEvents` and no event generic. Custom traits
use `userTraits: typed<UserTraits>()`. Strict examples use:

```typescript
validation: {
  onFailure: "throw",
  onError: (error) => reportValidationFailure(error),
}
```

Document default drop, sanitized debug output, and no payload retention. Remove
module-level client helper usage; applications import their owned instance.
Document that concurrent async-validation calls are not delivery-ordered and
that initialization/provider errors retain their existing behavior.

- [ ] **Step 4: Correct root import guidance**

Describe root `trakoo` as shared types plus environment-neutral event helpers.
Factories/providers remain on client/server subpaths.

- [ ] **Step 5: Verify and commit core docs**

```bash
rg -n 'CreateEventDefinition|EventCollection|as const satisfies|properties: \{\} as|create(Client|Server)Analytics<' readme.md www/content/docs/'(Getting Started)' www/content/docs/core-concepts
pnpm build:docs
git add readme.md www/content/docs/'(Getting Started)' www/content/docs/core-concepts
git commit -m "docs: migrate core guides to Standard Schema events"
```

Expected: `rg` has no output/exit 1 and docs build PASS before commit.

---

### Task 7: Framework/Provider Docs, Migration Guide, and Release Verification

**Files:**
- Modify: `www/content/docs/guides/index.mdx`, `nextjs.mdx`, `sveltekit.mdx`, `meta.ts`
- Create: `www/content/docs/guides/standard-schema-migration.mdx`
- Modify: `www/content/docs/providers/bento.mdx`
- Modify: `www/content/docs/providers/custom.mdx`
- Modify: `www/content/docs/providers/emitkit.mdx`
- Modify: `www/content/docs/providers/index.mdx`
- Modify: `www/content/docs/providers/openpanel.mdx`
- Modify: `www/content/docs/providers/pirsch.mdx`
- Modify: `www/content/docs/providers/posthog.mdx`
- Modify: `www/content/docs/providers/proxy.mdx`
- Modify: `www/content/docs/providers/visitors.mdx`
- Create: `.changeset/standard-schema-events.md`

**Interfaces:**
- Consumes: final package API and migrated terminology.
- Produces: complete ecosystem docs, breaking migration path, release metadata, verified branch.

- [ ] **Step 1: Create the migration guide**

Use frontmatter:

```markdown
---
title: Standard Schema migration
description: Migrate legacy typed event collections to trakoo's runtime event registry.
---
```

Include sections `What changed`, `Type-only migration`, `Runtime validation`,
`Validation failures`, and `Client singleton migration`. Each contains literal
before/after code from the approved spec. Add `"standard-schema-migration"`
after `"index"` in `guides/meta.ts`.

- [ ] **Step 2: Migrate framework guides**

Shared event modules export the registry value. Client/server modules import
that value and pass `events: appEvents`; they do not import `AppEvents` types.
Use `typed<T>()` for primary examples and link to runtime validation guidance.

- [ ] **Step 3: Migrate every provider example**

Import a shared registry to keep examples focused:

```typescript
import { appEvents } from "@/lib/events";

const analytics = createClientAnalytics({
  events: appEvents,
  providers: [provider],
});
```

Use the server equivalent where appropriate. Proxy docs pass the same registry
to client proxy analytics and ingesting server analytics.

- [ ] **Step 4: Add breaking changeset**

Create `.changeset/standard-schema-events.md`:

```markdown
---
"trakoo": major
---

Replace type-asserted event collections with runtime `defineEvents()` registries based on Standard Schema. Add direct validator interoperability, validator-free `typed<T>()` events, propertyless events, inferred client/server factories, normalized validation failures, and validated provider outputs. This removes the legacy event helper types and client singleton convenience API; see the Standard Schema migration guide.
```

- [ ] **Step 5: Run stale API checks**

```bash
rg -n 'CreateEventDefinition|EventCollection|ExtractEventNames|ExtractEventPropertiesFromCollection|EventMapFromCollection|as const satisfies|properties: \{\} as|create(Client|Server)Analytics<' src test readme.md www/content
rg -n 'getAnalytics\(|resetAnalyticsInstance|createAnalytics as|createClientAnalytics as createAnalytics' src test readme.md www/content
```

Expected: no output and exit code 1 from both commands. Historical design/plan
documents are intentionally outside the scan.

- [ ] **Step 6: Run full verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm build:docs
pnpm verify:package
git diff --check origin/main...
```

Expected: every command PASS and diff check prints nothing.

- [ ] **Step 7: Commit release docs**

```bash
git add www/content/docs/guides www/content/docs/providers .changeset/standard-schema-events.md
git commit -m "docs: add Standard Schema migration guidance"
```

- [ ] **Step 8: Verify clean completion**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm build:docs && pnpm verify:package
git diff --check origin/main...
git status --short
```

Expected: all verification PASS, no diff-check output, and a clean worktree.
