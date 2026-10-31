# Notices and views

Views belong to a running request and outcomes are notices, as `architecture.md`
(Element, Requests, Display, Strings, Accessibility) describes.

- The views are `working`, `question` and `confirmation`, with their custom
  states. The `stop`, `error` and `info` views and states go away.
- When a request ends, the view goes away. A stop, an error and a done with a
  text are notices that go away by themselves; an info is a notice with its
  text, in its paragraphs, and a Close button (part `close`) that stays until
  the user closes it.
- The `tooLong` text is a notice that goes away by itself.
- A notice that goes away by itself is shown for `notice-duration` seconds or
  for its reading time, one second for every three words, whichever is longer.
  The pointer or the focus on it keeps it, as before, each notice on its own.
- The notices are a list, the newest last, each with the part `notice`. A new
  notice or a new request does not hide the ones shown. When a fourth would be
  shown, the oldest that goes away by itself is removed; an info never is.
- An info's text is not announced; the new `info` string, "New information", is.
  The other notices are announced as before.
- The `pageLoad` text is the `working` view's label while the element waits for
  a page load, announced once when the wait starts; text during the wait shows
  no notice.
- When an info is closed with the focus on its Close, the focus goes back to the
  page element it came from into the element, or to the element itself, as for a
  view.
- On `pagehide`, the element hides its view and all its notices.
- Browser tests: each outcome as a notice; an info that stays until Close and
  announces the `info` string; the reading time of a long notice; three notices
  at once and a fourth that removes the oldest, never an info; a stop that stays
  beside the `working` view of a new request from held text; the `pageLoad`
  label; the focus after Close on an info.
