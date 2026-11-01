# Announcement tests with a held round

The two tests in `test/browser/announcements.spec.ts` for the done announcement
pass only when the round ends within the announcement delay, so they fail under
load and do not check the usual case. They follow `architecture.md`
(Accessibility, Strings).

- "Done is announced for a done without a text, not shown" and "a done with a
  text announces its text, not Done" hold the round, check that "Working" is
  announced, answer it, then check the done announcement and, for the first,
  that "Done" is not shown and no notice is visible.
- No change to `src/`.
