---
"trakoo": patch
---

Ship the OpenPanel transport declarations again

`REQUEST_CONTEXT` was declared without an explicit type, which `isolatedDeclarations` rejects, so the declaration build dropped `providers/openpanel/transport.d.ts` from 1.2.0. `providers/client.d.ts` and `providers/server.d.ts` still imported it, so `OpenPanelDeliveryFailureHandler` resolved to an implicit `any` and an `onDeliveryFailure` callback failed to type-check under `noImplicitAny`.

`vite build` exits 0 when the declaration plugin rejects a file, so `verify:package` now asserts that every relative import in the packed declarations resolves to a file that was actually emitted.
