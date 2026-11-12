# History in rounds

Every round sends `history`, and `dicta.listHistory` is removed
(`architecture.md`, Requests, Storage and Built-in capabilities;
`contract-protocol.md` in `dicta-action-server`, Request body and History).

- Storage: `dicta-action-history` is oldest first. A finished request goes at
  the end, the 20 latest are kept, and when storage is full the oldest go first,
  from the start of the list.
- Before each round the element reads the history and sends a short entry for
  each kept request, oldest first, as `history`: `requestId`, `time`, `outcome`
  with its type and, when there is one, its text, then `text`, in this order.
  `text` and `outcome.text` are cut to 200 characters, as the short entry of
  `dicta.listHistory` is today. An empty history is sent as an empty array.
  Storage that cannot be read gives an empty history, and the round goes on.
- `dictaCapabilities` holds only `dicta.getHistory`. `dicta.listHistory` and its
  code, such as its default limit, are removed. `dicta.getHistory` keeps its
  behavior; its `desc` says it reads a request by the `requestId` of its history
  entry.

Tests: the unit tests of `dicta.listHistory` are removed, and those that read
the storage expect it oldest first. A browser test: a second request sends the
first one in `history`, with the fields in order and the texts cut, and a first
request sends an empty array; the 21st request drops the oldest; the round of a
request that goes on after a page load sends the same history.

Check: `npm run check`, `npm run lint`, `npm run test`, `npm run test:browser`
and `npm run build` pass.
