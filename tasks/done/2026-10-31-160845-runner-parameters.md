# Runner parameters

A refactor with no change in behavior (`architecture.md`, Plan runner).

- `runPlan`'s `stop` and `progress` parameters are required; only the tests used
  their defaults. A caller that leaves out `stop` is a type error.
- The tests pass both where they left them out.
