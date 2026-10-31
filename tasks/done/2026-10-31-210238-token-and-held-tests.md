# Token and held text tests

Browser tests for two behaviors that only unit tests or one case cover now
(`architecture.md`, Element and Requests; `contract-protocol.md` in
`dicta-action-server`, Added text and cancel). No change in behavior.

- `getToken` set as a property before the element is defined is used for the
  first round, as `Authorization: Bearer <token>`.
- A `getToken` set again later is used for the next round.
- Several texts held while waiting, followed by done: the first starts a new
  request, and the others are added text of that request.
