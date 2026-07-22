---
"trakoo": major
---

Replace type-asserted event collections with runtime `defineEvents()` registries based on Standard Schema. Add direct validator interoperability, validator-free `typed<T>()` events, propertyless events, inferred client/server factories, normalized validation failures, and validated provider outputs. This removes the legacy event helper types and client singleton convenience API; see the [Standard Schema migration guide](https://trakoo.co/docs/guides/standard-schema-migration).
