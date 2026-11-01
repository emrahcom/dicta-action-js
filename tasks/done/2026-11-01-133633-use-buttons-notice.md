# Use buttons notice

Text that comes while a confirmation is open is still ignored, and the element
shows the `useButtonsNotice` text, "Answer with the buttons", as a notice that
goes away by itself, as `specs/architecture.md` (Requests, Display and Strings)
describes.

- The confirmation stays open as it is; only its buttons answer it.
- Browser test: with a confirmation open, a submit shows the notice, the
  confirmation is still shown, and Continue then runs the step.
- Browser test: `strings` overrides `useButtonsNotice`.
