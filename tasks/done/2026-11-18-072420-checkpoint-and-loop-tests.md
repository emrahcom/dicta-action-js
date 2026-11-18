# Checkpoint and loop announcement tests

Two browser tests the implementation review of 2026-11-18 found missing.

- Cancel at a checkpoint (`contract-plan.md` in `dicta-action-server`,
  Checkpoint; `contract-protocol.md` there, Added text and cancel): the request
  ends without another round, the plan's first step does not run, and the
  history holds the request as cancelled, with a last report whose halt is
  `cancelled` at step 1.
- A `forEach` with a step text (`architecture.md`, Display and Accessibility):
  the status region announces the text once, when the step starts, and not for
  each item; the count is not announced.

Check: `npm run check`, `npm run lint`, `npm run test` and
`npm run test:browser` pass.
