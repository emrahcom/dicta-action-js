# Notice string keys

Rename the string keys `error` to `errorNotice` and `tooLong` to
`tooLongNotice`, as `specs/architecture.md` (Strings) describes, so a key tells
that its text is shown as a notice.

- The old keys are not kept: the package is not released yet.
- The tests that override these strings use the new keys.
