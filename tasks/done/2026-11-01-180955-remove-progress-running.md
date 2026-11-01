# Remove Progress.running

Remove the `running` field of `Progress` in `src/run.ts`, which nothing in
`src/` reads. No spec changes; the report so far still follows
`contract-protocol.md` in `dicta-action-server` (Page changes).

- Remove the field, its initial value in `newProgress` and the `running` helper;
  its two callers call `execute` directly.
- In `test/run.test.ts`, the test "the report so far halts at the running step
  with its outputs" keeps its report checks and drops the two `running` checks.
