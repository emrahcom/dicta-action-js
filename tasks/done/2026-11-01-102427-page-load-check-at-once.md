# Page load check at once

The runner checks for a page load as soon as a step or call returns, and waits
one task for a second check only when none was seen yet, as `architecture.md`
(Plan runner) describes.

- A page load seen when the step or call returns stops the runner at once, so
  the new page cannot come first and end the request as cancelled.
- Without a seen page load, the check one task later stays, for WebKit.
- Tests: a browser test that forces the race, if one is possible; otherwise the
  page load tests repeated under CPU load, reported with the result.
