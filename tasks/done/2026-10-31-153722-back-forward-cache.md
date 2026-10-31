# Back/forward cache

A page the browser keeps in its back/forward cache and shows again is clean and
can go on with a saved request, as `architecture.md` (Display, Storage) and
`contract-protocol.md` in `dicta-action-server` (Page changes) describe.

- On `pagehide`, after the request is saved or ended, the element hides its view
  and its notice, so a page shown again from the cache shows no request that is
  over.
- On `pagehide`, the element forgets that a page load started, so a round that
  fails later in a page shown again from the cache is an error at once.
- On `pageshow` from the cache, the element looks for a saved request, as when
  it starts on a page.
- Browser tests that fire the events: the view and the notice hidden after
  `pagehide`, a failed round shown at once after `pagehide`, and a saved request
  that goes on after `pageshow` from the cache.
