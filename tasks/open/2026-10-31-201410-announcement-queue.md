# Announcement queue

An announcement never replaces one that is not read yet, as `architecture.md`
(Accessibility) describes.

- When a text is announced while the one before it is still waiting to be set in
  the status region, both are set together, the earlier one first, instead of
  the later one only.
- A text equal to the last one set is still announced again.
- Browser tests: a stop followed at once by held text that starts a new request
  announces the stop text and then the `working` string; a plan whose first step
  asks announces its label and then the confirmation text.
