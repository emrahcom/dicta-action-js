# Product

dicta actions let users tell a web application what they want, in their own
words, and the application does it.

dicta-action-js is the browser side. The application gives it the user's request
as text; it asks `dicta-action-server` for a plan and runs the plan by calling
the site's capability functions, with the user's own rights.

## What it is

- A browser library with one element that shows what happens to a request: its
  progress, questions, confirmations and the result.
- A plan runner: it checks each plan, resolves its references, runs its steps
  and loops by calling the site's own functions, and reports the results. It
  never runs code it receives.
- Independent of where the text comes from: `dicta-js`, a plain text field or
  anything else. The application passes the text in.
- Independent of UI frameworks: it works in any web page.

## What it is not

- Not an input element. Typing and speech belong to `dicta-js` or the page.
- Not a planner. The server decides every step; the client only runs plans and
  reports back.
- Not the place for authentication. The application's backend issues the token.

## First version

- The site registers its capability module (`contract-capability.md` in
  `dicta-action-server`) and a token function.
- The application passes a request as text. The element runs it with the server
  round by round, until the server says it is done or stops.
- Before a destructive or external step, the user confirms with a button.
- A question from the server is shown with its options as buttons. While a
  question is open, the next text the application passes is the answer.
- Everything shown is short: the user wants the task done, not to read.
- A request goes on after a page load that its own plan causes, and ends when
  the user opens or reloads a page.
