# Notice and announce fixes

Two fixes in the element, as `architecture.md` (Display, Accessibility)
describes.

- A notice hidden while the pointer is over it or it has focus no longer keeps
  the next notice from going away: hiding a notice clears both. A hidden element
  does not reliably get `blur` (Firefox, WebKit) or `pointerleave`.
- A text announced twice in a row is announced again: the status region is
  cleared first and gets the text a moment later, so screen readers notice the
  change.
- Browser tests: a notice hidden by a new request while the pointer is over it
  or it has focus, then a next notice that goes away; and two equal stops in a
  row, both announced.
