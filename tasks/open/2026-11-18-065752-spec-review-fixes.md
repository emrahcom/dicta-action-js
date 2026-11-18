# Spec review fixes

The code follows the spec changes of the 2026-11-17 review (`contract-plan.md`
in `dicta-action-server`, Label, Checkpoint and Limits; `contract-protocol.md`
there, Request body and Report; `contract-capability.md` there,
`dicta.getHistory`; `architecture.md`, Display, Storage, Built-in capabilities
and Accessibility).

Plan check (`src/plan.ts`): `progress` holds at most 300 characters.

Old outputs (`src/run.ts`, `withoutOldOutputs`): an output over 512 bytes of a
plan before the last two goes into its report's `tooLarge`, or a halt output
into `halt.tooLarge`, with its size, in place of being dropped.

History (`src/history.ts`): when a request is stored, every output over 512
bytes goes into `tooLarge` with its size, in the last two plans too, whatever
the size of the entry. The step that replaced all outputs of an entry over 16 KB
goes. An entry still over 16 KB stays as it is; the report's limit handles it
when `dicta.getHistory` returns it.

Element (`src/element.ts`): a step's text is announced once, when the step
starts; the loop count stays shown only.

Tests:

- Unit: a progress of 300 characters passes and of 301 fails; old outputs over
  512 bytes are in `tooLarge` and `halt.tooLarge` with their sizes; a stored
  request keeps outputs of at most 512 bytes and lists larger ones in
  `tooLarge`, in every plan; an entry over 16 KB keeps its small outputs.
- Browser: a step's text is announced when the step starts and the count is not;
  the round after three plans lists the first plan's large output in `tooLarge`.

Check: `npm run check`, `npm run lint`, `npm run test`, `npm run test:browser`
and `npm run build` pass.
