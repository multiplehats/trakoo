---
"@stacksee/analytics": patch
---

Add `default` export condition to all subpath exports so CJS resolvers (e.g. tsx, esbuild) can find them
