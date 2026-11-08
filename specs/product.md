# Product

dicta actions let users tell a web application what they want, in their own
words, and the application does it.

`dicta-action-js` is the browser side. The application gives it the user's
request as text; it asks `dicta-action-server` for a plan and runs the plan by
calling the site's capability functions, with the user's own rights.

## What it is

- A browser library with one element that shows what happens to a request: its
  progress, questions, confirmations and the outcome.
- A plan runner: it checks each plan, resolves its references, runs its steps
  and loops by calling the site's own functions, and reports the outputs the
  plan asks for. It never runs code it receives.
- The home of the built-in capabilities, exported as `dictaCapabilities`, and of
  the history that some of them read: the finished requests of the tab, kept in
  its session storage (`contract-capability.md` in `dicta-action-server`,
  Built-in capabilities).
- Independent of where the text comes from: `dicta-js`, a plain text field or
  anything else. The application passes the text in.
- Independent of UI frameworks: it works in any web page.
- Accessible as a first-class feature: everything a sighted user sees or does is
  available to keyboard and screen reader users (`architecture.md`,
  Accessibility).

## What it is not

- Not an input element. Typing and speech belong to `dicta-js` or the page.
- Not a planner. The server decides every step; the client only runs plans and
  reports back.
- Not the place for authentication. The application's backend issues the token.

## First version

- The site registers its capability module (`contract-capability.md` in
  `dicta-action-server`) and, when the server checks tokens, a token function.
- The application passes a request as text. The element runs it with the server
  round by round, until the server replies with done, a stop or an info, or the
  request ends by cancel, an error or a page change.
- Text the application passes while a request runs is added text: it interrupts
  the plan, and the server decides what comes next (`contract-protocol.md` in
  `dicta-action-server`, Added text and cancel).
- Before a risky step, the user presses Continue or Cancel (`contract-plan.md`
  in `dicta-action-server`, Confirmation).
- A question from the server is shown with its options as buttons. While a
  question is open, the next text the application passes is the answer.
- Everything shown is short: the user wants the task done, not to read.
- A request goes on in the new page when a step of a capability with `pageLoad`
  loads it. A page load at any other time ends the request
  (`contract-protocol.md` in `dicta-action-server`, Page changes).
