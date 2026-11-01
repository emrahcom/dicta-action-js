# Notice close and pause

Every notice has a Close button, and the pointer or the focus pauses a notice's
time instead of starting it again, as `architecture.md` (Element, Display,
Strings, Accessibility) describes.

- Every notice, not only an info, has its text and a Close button (part `close`)
  that removes it at once.
- While the pointer is over a notice that goes away by itself or it has focus,
  its time stops; when they leave, it goes on with the time that was left.
- When a notice is closed with the focus on its Close, the focus goes back as
  before.
- Browser tests: Close removes a stop notice at once; a notice hovered after
  part of its time goes away after only the rest of its time once the pointer
  leaves; the focus after Close on a stop notice.
