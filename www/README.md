# StackSee Analytics Docs

This package contains the Blume documentation site for `trakoo`.

## Commands

```bash
pnpm --filter @stacksee/docs dev
pnpm --filter @stacksee/docs build
pnpm --filter @stacksee/docs exec blume validate --strict
```

Content lives in `content/docs`. Navigation is derived from the filesystem and refined with `meta.ts` files.

Provider logos on the providers index use Parsew Brands with a publishable client key.
