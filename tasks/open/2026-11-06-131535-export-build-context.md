# Export buildContext

Export `buildContext` from the package entry, as `architecture.md` (Delivery)
describes, for the harness check.

- `src/index.ts` exports `buildContext` and its `SiteContext` type, with no
  change to the function. `test/context.test.ts` already covers it.
- Check with `npm run build` that `dist/index.d.ts` declares both.
- Release `0.1.1` afterwards, by `docs/releasing.md`, so the harness can take it
  from npm.
