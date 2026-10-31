# Architecture

## Flow

```
application --text--> dicta-action-js (browser) --round--> dicta-action-server
                                                <--reply--
```

1. The page loads `dicta-action-js` and the site's capability module, puts the
   `<dicta-action>` element on the page and gives it the module.
2. The application passes the user's text to the element, from `dicta-js`, a
   text field or anything else.
3. The element runs the request with the server round by round
   (`contract-protocol.md` in `dicta-action-server`): it sends the request, runs
   each plan with the module's capabilities, shows questions and confirmations
   and reports back, until the request ends.

The contracts and the glossary are in `dicta-action-server/specs/`. This file
names them without the repo.

## Delivery

- ES modules with no runtime dependencies, written in TypeScript and compiled to
  JavaScript for the browser.
- Published to npm as `dicta-action-js`, with the compiled JavaScript and its
  TypeScript type declarations. The capability module imports
  `dictaCapabilities` from it, so the site bundles both into its pages.
- Importing the package defines `<dicta-action>`, a custom element, so it works
  in any page and with any UI framework. Its markup and styles live in a shadow
  root, so the page's styles do not break it.
- Supported browsers: the current and previous major version of Chromium-based
  browsers, Firefox and Safari, desktop and mobile.

## Element

- `server`: the origin of `dicta-action-server`, for example
  `https://example.com`. A path in it is ignored, since all server paths start
  with `/dicta-action/`.
- `module`: a property, the capability module's default export
  (`contract-capability.md`). The element builds the site context from it once
  (`contract-context.md`).
- `getToken`: an optional async function that returns the token as a string, as
  in `dicta-js`. It is called for the first round and again after a `401`; the
  element keeps the token in memory between rounds. Without it, rounds are sent
  without `Authorization`, for a server with authentication turned off.
- `notice-duration`: how long a notice is shown (Display), in seconds, a whole
  number from 1, by default 5. Another value is ignored, and 5 applies.
- `texts`: an optional object that overrides the element's own texts by key
  (Texts).
- `submit(text)`: a method that passes the user's text. The text is trimmed;
  empty text is ignored. What it does depends on the request (Requests).

With `dicta-js`:

```js
input.addEventListener("dicta-text", (e) => action.submit(e.detail.text));
```

CSS parts let the integrator style or hide each part of the element:

- `label`: the plan's label and the progress indicator.
- `message`: the text of a question, a stop, an info or an error.
- `notice`: a notice (Display).
- `option`: each option button of a question.
- `confirm`: the confirmation texts and the hint.
- `continue`, `cancel`, `close`: the buttons.

## Requests

The element runs one request at a time. `submit(text)`:

- With no request running: starts a new request.
- While a question is open: answers it.
- While a confirmation is open: is ignored, and the element shows the hint
  "Click Continue or Cancel" (Texts) until the confirmation ends.
- While the element waits for the server or runs a plan: is added text
  (`contract-protocol.md`, Added text and cancel). The client takes all text
  that comes; background speech from an always-open microphone is a known open
  point.
- Text over 10000 characters (Unicode code points) is not taken: the element
  shows the `tooLong` text as a notice (Display) and nothing else changes
  (`contract-protocol.md`, Limits).

The text becomes the request's `text`, a question's `answer` or an `added` item
(`contract-protocol.md`, Request body).

Before each round the element calls `module.state.run()` for `state` and takes
`time` from the browser: local time to the second, with the offset as numbers,
`+00:00` too, never `Z` (`contract-protocol.md`, Request body).

A round is `POST <server>/dicta-action/v1/round`. A `401` gets a new token and
one more try with the same body. Every other HTTP error, a network failure, a
round without a response after 60 seconds and a reply type the element does not
know end the request as an error, with no retry (`contract-protocol.md`,
Errors). The element logs the server's `error` to the console, for the site's
developers.

## Display

The element shows little: the user wants the task done, not to read.

From the submit until the request ends, the element shows one view at a time,
and each view has its own Cancel button, placed to fit the view:

- Working, while the element waits for the server or runs a plan: a progress
  indicator, with the label of the running plan when it has one, and Cancel.
- Question: the question's text, its options as buttons and Cancel. A click on
  an option answers with the option's text.
- Confirmation: only the texts from the module's `confirm` as plain text,
  without the plan's label (`contract-plan.md`, Confirmation), Continue and
  Cancel. For a `forEach`, the number of items and the first three items.

An answer or Continue brings back the working view. Cancel in any view cancels
the request (`contract-protocol.md`, Added text and cancel).

After the request, or beside it:

- A notice: a short text that goes away by itself and never waits for a click:
  the text of a done and the `tooLong` text. It is shown for `notice-duration`
  seconds. While the pointer is over it or it has focus, it stays, and the time
  starts again when they leave.
- Done with a text: its text is shown as a notice. Done without a text: nothing
  is shown; the progress indicator goes away.
- A stop and an error: shown until the user closes them or submits new text.
- An info: shown with its paragraphs until the user closes it
  (`contract-protocol.md`, Response body).

## Plan runner

The runner follows `contract-plan.md` and builds the report of
`contract-protocol.md`, Report.

- It checks the whole plan before any step runs (`contract-plan.md`, Failures).
  A plan that fails gets a report with the halt code `invalid`.
- Arguments are checked against the capability's schema with the keywords the
  capability contract allows, the same check as the server's. Properties are
  read with `Object.hasOwn`, never with `in`, so names every object inherits,
  such as `__proto__` and `toString`, are never taken as present.
- References are filled in before each call and the arguments are checked again.
  A string that starts with `$$` is passed on with a single `$`.
- Added text, cancel and page changes are seen between steps, and in a `forEach`
  between items; a step or an item that started always finishes
  (`contract-protocol.md`, Added text and cancel).
- Error messages are cut to 200 characters. Included outputs are counted as the
  UTF-8 bytes of their JSON, at most 16 KB together.

## Storage

The element keeps two entries in the tab's `sessionStorage`, as JSON:

- `dicta-action-saved`: the request saved on `pagehide` while a step runs:
  `savedAt` (milliseconds since 1970, for the 60 second check), `requestId`,
  `text`, `exchange`, the running plan, the report so far and the running
  `step`, with `item` and `do` in a `forEach` (`contract-protocol.md`, Page
  changes).
- `dicta-action-history`: the finished requests, newest first, each with
  `requestId`, `time`, `text`, `outcome` and `exchange`. At most 20 requests;
  when storage is full, the oldest go first.

When the element has its `server` and `module`, it looks for a saved request,
takes it out and goes on or ends it (`contract-protocol.md`, Page changes).

## Built-in capabilities

`dictaCapabilities` holds `dicta.listHistory` and `dicta.getHistory`
(`contract-capability.md`, Built-in capabilities), with `args` and `output`
schemas. They read `dicta-action-history` directly, so they need no element.

## Texts

The element's own texts are English. `texts` overrides any of them by key, for
example with the site's own translations:

- `continue`: "Continue"
- `cancel`: "Cancel"
- `close`: "Close"
- `confirmHint`: "Click Continue or Cancel"
- `error`: "Something went wrong"
- `tooLong`: "The text is too long"

A key left out keeps its English text. An unknown key, or a value that is not a
string, is ignored. The element reads `texts` each time it shows a text, so a
site that changes its language sets `texts` again.

Texts from the server and from the module's `confirm` are shown as they come.

## Accessibility

The element meets WCAG 2.2 level AA.

- Everything works by keyboard, with a visible focus indicator. A new
  confirmation or question moves the focus to its first button.
- Progress, questions, confirmations and outcomes are announced through a status
  region, which is separate from the visible parts, so hiding a part does not
  silence it.
- All text and buttons have enough contrast.
