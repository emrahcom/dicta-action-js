# Architecture

## Flow

```
application
     |
    text
     |
     v
dicta-action-js (browser) <--rounds--> dicta-action-server
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
- It also exports `buildContext`, which the element uses to turn a capability
  module into the site context (`contract-context.md`). The harness check uses
  it too, so it sees the context the server will get.
- It exports the element's class, `DictaAction`, the types a capability module
  is written with (`CapabilityModule`, `Capability`, `Level` and `Schema`) and
  `SiteContext`, the type `buildContext` returns. The harness check types a
  module against the module types.
- Importing the package defines `<dicta-action>`, a custom element, so it works
  in any page and with any UI framework. Its markup and styles live in a shadow
  root, so the page's styles do not break it.
- Supported browsers: the current and previous major version of Chromium-based
  browsers, Firefox and Safari, desktop and mobile.

## Element

- `server`: an attribute, the origin of `dicta-action-server`, for example
  `https://example.com`. A path in it is ignored, since all server paths start
  with `/dicta-action/`.
- `module`: a property, the capability module's default export
  (`contract-capability.md`). The element builds the site context from it once
  (`contract-context.md`).
- `getToken`: an optional async function that returns the token as a string, as
  in `dicta-js`. It is called for the first round and again after a `401`; the
  element keeps the token in memory between rounds. Without it, rounds are sent
  without `Authorization`, for a server with authentication turned off.
- `strings`: an optional object that overrides the element's own strings by key
  (Strings).
- `submit(text)`: a method that passes the user's text. The text is trimmed;
  empty text is ignored. What it does depends on the request (Requests).

With `dicta-js`:

```js
input.addEventListener("dicta-text", (e) => action.submit(e.detail.text));
```

CSS parts let the integrator style or hide each part of the element:

- `view`: the box that holds the view shown (Display).
- `indicator`: the progress indicator.
- `label`: the `working` view's label: the plan's label or the `pageLoad` text.
- `text`: the text of a question or a confirmation.
- `buttons`: the box that holds the buttons of a view or a notice, under the
  rest of it (Display).
- `option`, `continue`, `cancel`: the buttons of a view.
- `notice`: each notice (Display).
- `close`: the Close button of a notice.

While a view is shown, the element has a custom state with the view's name
(Display): `working`, `question` or `confirmation`. With the state, a part is
styled in one view only:

```css
dicta-action:state(confirmation)::part(view) {
  max-width: 40rem;
}
dicta-action:state(question)::part(cancel) {
  color: gray;
}
```

## Requests

The element runs one request at a time. `submit(text)`:

- With no request running: starts a new request.
- While a question is open: answers it.
- While a confirmation is open: is ignored; only its buttons answer it
  (`contract-protocol.md`, Added text and cancel). The element shows the
  `useButtonsNotice` text as a notice (Display).
- While the element waits for the server or runs a plan, before a page load
  starts: is added text (`contract-protocol.md`, Added text and cancel).
- From the start of a page load during a request until the page is left: is
  ignored; the `working` view shows why (Display; `contract-protocol.md`, Page
  changes).
- Text over the limit of `text` (`contract-protocol.md`, Limits) is not taken:
  the element shows the `tooLongNotice` text as a notice (Display) and nothing
  else changes.

The text becomes the request's `text`, a question's `answer` or an `added` item
(`contract-protocol.md`, Request body).

Before each round the element calls `module.state.run()` for `state` and takes
`time` from the browser (`contract-protocol.md`, Request body).

A round is `POST <server>/dicta-action/v1/round`. A `401` gets a new token and
one more try with the same body. Every other HTTP error, a network failure, a
round without a response after 60 seconds, a reply type the element does not
know, a `getToken` or `module.state.run()` that throws and a request started
before the element has its `server` and `module` end the request as an error,
with no retry (`contract-protocol.md`, Errors). The element logs the cause to
the console, such as the server's `error`, for the site's developers.

## Display

The element shows one view at a time, or none, and notices beside it. A view
belongs to a running request: it shows where the request is and what the user
can do with it. A notice only tells something and belongs to no running request.

While a request runs, from the submit on, each view has its own Cancel button,
placed to fit the view:

- `working`, while the element waits for the server, runs a plan or waits for a
  page load: a progress indicator, a label and Cancel. The label is the running
  plan's label when it has one, and the `pageLoad` text while the element waits
  for a page load, announced once when the wait starts. The indicator is a small
  spinner drawn with CSS. When the user prefers reduced motion
  (`prefers-reduced-motion`), it stands still.
- `question`: the question's text, its options as buttons and Cancel. Pressing
  an option answers with the option's text.
- `confirmation`: only the texts from the module's `confirm` as plain text
  (`contract-plan.md`, Confirmation), Continue and Cancel. The items and counts
  come from `contract-plan.md`, Confirmation; a count is shown with the `items`
  string.

The buttons go under the text or the label, in their own `buttons` box, aligned
to the left:

- `question`: the options, one per line, then Cancel on a line of its own, so it
  does not look like another answer.
- `confirmation`: Continue and Cancel side by side on one line.
- `working` and a notice: their button on a line of its own.

An answer or Continue brings back `working`. Cancel in any view cancels the
request (`contract-protocol.md`, Added text and cancel).

When a request ends, the view goes away and the outcome is a notice:

- a stop or a done with a text: the text;
- an error: the `errorNotice` text (Strings);
- an info: the text, in its paragraphs (`contract-protocol.md`, Response body);
- a done without a text shows nothing.

An info stays until the user closes it. Any other notice stays until the user
closes it or a new request starts. Every notice has a Close button.

The notices are a list, the newest last. When a fourth would be shown, the
oldest that is not an info goes first. Only an info removes an info: when all
three are infos, a new info removes the oldest, and another notice is shown as a
fourth.

On `pagehide`, the element hides its view and its notices, so a page the browser
shows again from its back/forward cache shows no request that is over.

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
- Added text and cancel are seen between steps, and in a `forEach` between
  items; a step or an item that started always finishes (`contract-protocol.md`,
  Added text and cancel).
- Page loads (`contract-protocol.md`, Page changes):
  - A page load is a `navigate` event of the Navigation API for another document
    (`destination.sameDocument` is false).
  - A download is not one: an event with a `downloadRequest`, and a later one to
    the same URL, which Firefox fires too.
  - Only a capability with `pageLoad` is checked: the runner looks for one after
    each call of such a capability, and ignores one at any other time.
  - It checks at once. Only when it sees none, it checks once more one task
    later, since WebKit fires the event late for `location.reload()`. It never
    waits after a seen page load: the new page could come first and end the
    request.
  - When it sees one, it stops, and the element waits for the page to be left.
  - Without the Navigation API, page loads are not seen and the runner goes on.
- Messages and included outputs follow `contract-protocol.md`, Limits.

## Storage

The element keeps two entries in the tab's `sessionStorage`, as JSON:

- `dicta-action-saved`: the request saved on `pagehide` while the element waits
  for a page load: `savedAt` (milliseconds since 1970, for the 60 second check),
  `requestId`, `text`, `exchange`, the plan, its report, with the halt
  `navigated` at the first step that did not run or no halt, and the added text
  (`contract-protocol.md`, Page changes).
- `dicta-action-history`: the finished requests, newest first, each with
  `requestId`, `time`, `text`, `outcome` and `exchange`. As many as
  `contract-capability.md`, History allows; when storage is full, the oldest go
  first, also to make room for the saved request.

When the element has its `server` and `module`, it looks for a saved request,
takes it out and goes on or ends it (`contract-protocol.md`, Page changes). It
looks only once the running code yields, at its end or its first `await`, so
`getToken` and the other properties set with them in the same synchronous code
can be set in any order. It looks again when the page is shown from the
back/forward cache (`pageshow`).

## Built-in capabilities

`dictaCapabilities` holds the built-in capabilities (`contract-capability.md`,
Built-in capabilities).

The history capabilities, `dicta.listHistory` and `dicta.getHistory`, read
`dicta-action-history` from session storage themselves, so they do not depend on
the `<dicta-action>` element.

## Strings

The element's own strings are English. `strings` overrides any of them by key,
for example with the site's own translations:

- `continue`: "Continue"
- `cancel`: "Cancel"
- `close`: "Close", for a notice
- `done`: "Done", announced only, for a done without a text (Accessibility)
- `errorNotice`: "Something went wrong"
- `info`: "New information", announced only, when an info is shown
  (Accessibility)
- `items`: "{count} items", the number of items in a `forEach` confirmation, or
  of top-level steps of one write capability (Display); the element puts the
  number in place of `{count}`
- `pageLoad`: "Wait for the page to load", the `working` view's label while the
  element waits for a page load (Display)
- `tooLongNotice`: "The text is too long"
- `useButtonsNotice`: "Answer with the buttons"
- `working`: "Working", announced only, when a request starts or goes on in a
  new page (Accessibility)

A key left out keeps its English string. An unknown key, or a value that is not
a string, is ignored. The element reads `strings` each time it shows or
announces one, so a site that changes its language sets `strings` again.

Texts from the server and from the module's `confirm` are shown as they come,
always as plain text, never as HTML.

## Accessibility

The element meets WCAG 2.2 level AA.

- Everything works by keyboard, with a visible focus indicator.
- The element never takes the focus from outside it. A new view does not take it
  from the site's text field, so Enter there can never press Continue.
- When a view goes away while the focus is in it, the focus moves to the next
  view's Cancel. When no view follows, or a notice is closed with the focus on
  its Close, the focus goes back to the page element it came from into the
  element, usually the site's text field. If that one is gone, it goes to the
  `<dicta-action>` element itself (`tabindex="-1"`).
- Progress, questions, confirmations and notices are announced through a status
  region, which is separate from the visible parts, so hiding a part does not
  silence it. Each text empties the region and is written into it 100 ms later,
  so a screen reader sees a change. Texts that come within those 100 ms are
  written together, one per line, so none is dropped.
- A question is announced with its options, each after the question's text, so a
  screen reader user knows the options are there.
- An info's text is not announced, since it can be long: the `info` string is.
  Its notice can take the focus, so the user moves to it to read the text.
- A screen reader user hears every request from start to end, also where the
  screen shows little: the `working` string when a request starts or goes on in
  a new page, the plan's label when it has one, and the `done` string for a done
  without a text.
- All text and buttons have enough contrast.
