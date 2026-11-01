# Reserved halt codes

A capability error whose `code` is one of the client's own halt codes is
reported as `capability`, as `contract-capability.md` (Errors) and
`contract-protocol.md` (Report) in `dicta-action-server` describe.

- The client's own codes are those listed under `halt.code` in the protocol:
  `capability`, `reference`, `limit`, `invalid`, `cancelled`, `interrupted` and
  `navigated`.
- The error's `message` is still reported.
- Unit test: a capability that throws with the code `invalid` halts with
  `capability` and its message; one with `not_found` keeps its code.
