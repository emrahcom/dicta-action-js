# dicta-action-js

Browser side of dicta actions. Users tell your web site what they want, in their
own words, and the site does it.

Version 0.x. The API may still change. The release notes tell you when you must
change your code.

## How it works

You put one element on your page: `<dicta-action>`. You pass it the user's
request as text. The text can come from a text field or from speech, such as
`dicta-js`.

- The element sends the request to `dicta-action-server`, which makes a plan.
- The element runs the plan with your site's own functions, with the user's
  rights. It never runs code it receives.
- Before a risky step, such as a delete, it asks the user to continue or cancel.
- It shows what happens: progress, questions and the outcome. Keyboard and
  screen reader users get the same.

Your capability module tells the planner what it can do on your site, and how.

## Install

```sh
npm install dicta-action-js
```

## Quick start

```ts
import { DictaAction } from "dicta-action-js";
import myModule from "./dicta-module";

const action = document.querySelector<DictaAction>("dicta-action")!;
action.getToken = async () => {
  const response = await fetch("/api/dicta-token");
  return (await response.json()).token;
};
action.module = myModule;

action.submit("plan the lemon cake for Friday");
```

```html
<dicta-action server="https://dicta.example.com"></dicta-action>
```

- `server`: the address of your `dicta-action-server`.
- `getToken`: returns a short-lived token from your backend. Set it before
  `module`.
- `module`: your capability module.
- `submit(text)`: runs a request.

## Documents

- Writing a capability module and adding dicta to your site:\
  https://github.com/emrahcom/dicta-action-harness
- The server and the formats of the module and the plan:\
  https://github.com/emrahcom/dicta-action-server
- How this library works:\
  https://github.com/emrahcom/dicta-action-js/tree/main/specs

## License

Apache-2.0
