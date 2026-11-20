# Runner structure

Structure fixes from the code quality review of 2026-11-20, with no change in
behaviour: `runPlan` becomes a short loop, and code moves to the file a reader
would look in.

- `src/run.ts`, `runPlan`:
  - the checkpoint, the confirmation of a call step, the confirmation of a
    `forEach` and the run of a `forEach` become their own functions, each
    returning the halt or nothing, so the loop needs no `Stopped` exception to
    leave its nested blocks;
  - one helper builds the halt of a `forEach`, with its outputs when the step
    includes them;
  - it takes the plan, the module and the progress, and its callbacks (`ask`,
    `stop`, `pageLoad` and `show`) in one object, so a call reads without the
    signature next to it.
- `src/exchange.ts`, new: making old outputs small for the exchange and the
  history (`withSmallOutputs`, `withoutOldOutputs` and their limits), moved from
  `run.ts` (`contract-protocol.md` in `dicta-action-server`, Request body;
  `architecture.md`, Storage). `history.ts` and `element.ts` import it from
  there.
- `src/style.ts`, new: the element's CSS, moved from `element.ts`.
- `src/element.ts`, `#runPlan`: the call of `runPlan` with the reset of the
  running plan after it moves into a small method, so `#runPlan` loses the
  nested `try` that the 2026-11-20 cleanups added.

Tests: the existing tests pass, changed only where `runPlan` is called.

Check: `npm run check`, `npm run lint`, `npm run test`, `npm run test:browser`
and `npm run build` pass.
