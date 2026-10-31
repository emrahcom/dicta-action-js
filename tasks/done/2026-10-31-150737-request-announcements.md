# Request announcements

A screen reader user hears every request from start to end, as `architecture.md`
(Strings, Accessibility) describes.

- The strings `working` ("Working") and `done` ("Done"), with `strings`
  overrides. They are announced only, never shown.
- `working` is announced when a request starts and when a saved request goes on
  in a new page.
- `done` is announced for a done without a text; nothing is shown.
- Browser tests for each point, with an override, and a check that neither
  string appears on screen.
