# Added text and cancel

Text the user gives while a request runs, cancel during a plan, and text that is
too long, as `architecture.md` (Requests, Plan runner) and
`contract-protocol.md` in `dicta-action-server` (Added text and cancel, Limits)
describe. It replaces the rule that `submit` is ignored while a request runs.

- The runner checks for added text and cancel between steps, and in a `forEach`
  between items; a step or an item that started always finishes.
- Added text while a plan runs: the plan halts with the code `interrupted` at
  the first step or item that did not run, without `do`, and with the items that
  ran in `halt.outputs` when the step has `includeOutput`. Each text follows the
  report as its own `added` item, and the next round is sent. Text that comes
  after the last step and before the report is sent adds `added` items without a
  halt.
- Text while the element waits for the server is held. After a plan or a
  question, the reply is dropped and a new round is sent with the same
  `requestId`, the exchange as it was and the `added` items. After done, a stop
  or an info, the request is over and the held texts are given again, so the
  first starts a new request.
- Cancel while a plan runs: the step or item that started finishes, nothing
  after it runs and no round is sent.
- Text over 10000 characters is not taken: the `tooLong` notice is shown and
  nothing else changes.
- Unit tests for the runner and browser tests for each point.
