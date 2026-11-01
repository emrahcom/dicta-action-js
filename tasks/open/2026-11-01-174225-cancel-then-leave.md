# Cancel then leave

A request cancelled while a step runs is stored in the history when the page is
left before that step returns, as `contract-protocol.md` in
`dicta-action-server` describes (Added text and cancel, Page changes).

- Today Cancel leaves the store to the end of the running step, and `pagehide`
  no longer sees the request, so a page left before the step returns stores
  nothing.
- On `pagehide`, such a request is stored as cancelled, with a last report that
  has the halt code `cancelled` at the running step, as for a page left while a
  step runs without a Cancel. It is stored once.
- Browser test: a slow step, Cancel, then a page change before the step returns;
  the request is in the history as cancelled at that step.
