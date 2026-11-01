# Notices without a timer

Notices no longer go away by themselves, as `specs/architecture.md` (Element and
Display) describes.

- Remove the `notice-duration` attribute, the timer, the reading time and the
  pause on hover and focus.
- An info stays until the user closes it. Any other notice stays until the user
  closes it or a new request starts.
- When a fourth would be shown, the oldest that is not an info goes first; with
  three infos, another notice is shown as a fourth.
- Browser tests:
  - a stop notice is still shown after a long time (`page.clock`);
  - a new request removes the notices that are not infos and keeps the infos;
  - Close removes a notice;
  - the tests that use `notice-duration` or wait for a notice to go away are
    changed or removed.
