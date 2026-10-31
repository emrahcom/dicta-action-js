# Saved report only

The saved request keeps the running step only in its report, as
`architecture.md` (Storage) and `contract-protocol.md` in `dicta-action-server`
(Page changes) describe.

- The saved request no longer has `step`, `item` and `do` of its own; the
  report's halt has them.
- The saved requests the tests write drop these fields too; otherwise the tests
  pass unchanged.
