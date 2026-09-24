# trakoo docs

This package contains the Blume documentation site for `trakoo`.

## Commands

```bash
pnpm --filter @trakoo/docs dev
pnpm --filter @trakoo/docs build
pnpm --filter @trakoo/docs exec blume validate --strict
```

Content lives in `content/docs`. Navigation is derived from the filesystem and refined with `meta.ts` files.

Provider logos on the providers index use Parsew Brands with a publishable client key.
