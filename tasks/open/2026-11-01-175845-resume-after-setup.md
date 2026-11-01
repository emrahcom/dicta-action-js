# Resume after setup

The element looks for a saved request only after the page's script that set its
`server` and `module` has run, as `specs/architecture.md` (Storage, the
paragraph on the saved request) describes.

- Today setting `module` or `server` looks at once, so a `getToken` set after
  them is missing from the round that goes on: it is sent without
  `Authorization`, gets a `401` and ends as an error.
- The look runs in a microtask, so properties set in the same script are in
  place. It still looks only once both are set and no request runs.
- Browser test: a page that sets `server`, then `module`, then `getToken`, goes
  on with a saved request; the round carries the token.
