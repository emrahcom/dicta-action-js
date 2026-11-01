# Simplify element

Remove checks in `src/element.ts` that can never be true, and a duplicated
browser test. No spec changes; behavior stays as `specs/architecture.md`
(Requests, Storage) describes.

- `#end` gets only a done, a stop or an info, for the running request. Its
  parameter type says so, and its checks for a plan, a question and another
  request go.
- `#store` passes the outcome and the exchange to `addHistory` as they are:
  `addHistory` turns the entry into JSON at once, which drops an empty `text`
  and copies the exchange.
- On `pagehide`, a cancelled request is stored when its step has not returned;
  the `left` check there goes, since such a request is never marked left.
- In `test/browser/plans.spec.ts`, "Cancel while a plan runs sends no report" is
  removed; "Cancel during a plan lets the step finish and runs nothing after" in
  `added.spec.ts` checks the same and more.
