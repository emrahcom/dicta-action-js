# Bad item in the message

When a `forEach` that asks finds a bad item while it checks every item first,
the halt's message starts with the item's number, from 0, as in `item 3: ...`,
as `contract-plan.md` (Confirmation) in `dicta-action-server` describes.

- Only that check before asking is changed; a `forEach` that does not ask halts
  at the bad item with `item` and `do` as now.
- Unit test: a `forEach` that asks, with a bad second item, halts with
  `reference`, no `item`, a message that starts with `item 1: `, and nobody is
  asked.
