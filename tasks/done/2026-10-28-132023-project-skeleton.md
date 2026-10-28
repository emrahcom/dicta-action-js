# Project skeleton

Set up an empty TypeScript project for the browser, with the same tools as
`dicta-js`.

- npm as the package manager, `"private": true` until the first release. Node.js
  24 or later for the tools.
- TypeScript 7 with `strict`, Prettier with `proseWrap: always`, Oxlint with
  type-aware rules, Node's built-in test runner; the same settings as
  `dicta-js`.
- `tsc` compiles `src/` to ES modules in `dist/`, with the DOM types and type
  declarations. `package.json` has `exports` and `files` for `dist/`, as in
  `dicta-js`.
- npm scripts: `build`, `check` (format and type check), `format`, `lint`,
  `lint:fix`, `test`.
- `src/index.ts` as the empty entry module, with one test that imports it, so
  the test setup is proven.
- `.gitignore` with `node_modules/` and `dist/`, and the Apache-2.0 `LICENSE`.
- Fill in the verification commands in `CLAUDE.md`.

Browser tests (Playwright) come with the first task that needs a browser.
