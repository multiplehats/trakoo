---
"trakoo": major
---

Replace type-asserted event collections with runtime `defineEvents()` registries based on Standard Schema. Add direct validator interoperability, validator-free `typed<T>()` events, propertyless events, inferred client/server factories, normalized validation failures, and validated provider outputs. Server `track()` calls now fail closed with the new `invalid_options` code when the options argument contains an unrecognized key, and Proxy replay no longer re-runs Standard Schema validators against already-validated client output. This removes the legacy event helper types and client singleton convenience API; see the [Standard Schema migration guide](https://trakoo.co/docs/guides/standard-schema-migration).
