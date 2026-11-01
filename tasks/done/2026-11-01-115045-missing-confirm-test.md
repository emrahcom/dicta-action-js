# Missing confirm test

A unit test for a step that asks while its capability has no `confirm`, as
`contract-capability.md` (Capabilities, `confirm`) in `dicta-action-server`
describes: the step fails with `capability` and nothing runs.

- A destructive capability without `confirm`: the halt has the code `capability`
  at its step, the user is not asked and `run` is not called.
- No change to `src/`.
