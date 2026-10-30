# dicta-action-js

The browser side of dicta actions. dicta actions let users control a web
application in their own words, through AI. This library sends the request to
`dicta-action-server` and acts on its replies; it runs plans with the site's own
functions and the user's rights. The text can come from any source, for example
dicta-js. The details are in `specs/`.

## Specs and tasks

- `specs/` is authoritative; code follows it. Specs are living documents: write
  only what the next task needs and update them whenever needed.
- The action contracts (the protocol, the plan format, the capability format and
  the site context format) are in `dicta-action-server`, the source of truth for
  all action repos. They are not copied here. Locally they are in
  `../dicta-action-server/specs/`, otherwise
  https://github.com/emrahcom/dicta-action-server/tree/main/specs
- Tasks are files in `tasks/open/` and `tasks/done/`, named
  `YYYY-MM-DD-HHMMSS-slug.md` (UTC). The folder is the status. `specs/tasks.md`
  defines the format, including how findings are handled.

## Verification commands

Run them after every change.

- Format and type check: `npm run check`
- Lint: `npm run lint`
- Tests: `npm run test`
- Build: `npm run build`

`npm run format` fixes formatting.

## User documents

The README and other user documents use simple English: short sentences, common
words, one idea per sentence. Most readers know English as a second language.
Specs are internal and not covered by this rule.

## Commits

Type prefix (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`), subject only,
no body, no trailers. A task lands as up to three commits:

- `docs: <spec change>`
- `chore: add task 2026-10-28-120000-project-skeleton`
- `<type>: implement 2026-10-28-120000-project-skeleton`, with the type that
  fits the change. It also moves the task file to `tasks/done/`.
