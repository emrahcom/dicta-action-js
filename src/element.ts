// The <dicta-action> element: it takes the user's text, runs the request with
// the server and shows what happens to it (specs/architecture.md).

import type { SiteContext } from "./context.ts";
import type { CapabilityModule } from "./module.ts";
import { checkPlan, type Plan } from "./plan.ts";
import { addHistory, type Outcome } from "./history.ts";
import { localTime, type Reply, RoundClient } from "./round.ts";
import { type Confirmation, cut, type Report, runPlan } from "./run.ts";

type View = "working" | "question" | "confirmation" | "stop" | "error" | "info";

// A running user request (contract-protocol.md, Request body).
type Request = {
  text: string;
  requestId?: string;
  exchange: unknown[];
  // The text of the open question.
  question?: string;
  // While a confirmation is open, text is ignored.
  confirming?: boolean;
  // Text the user added that is not in the exchange yet.
  added: string[];
  // While a plan runs; a cancel then waits for its last report.
  running?: boolean;
};

// The element's own strings (specs/architecture.md, Strings).
const STRINGS = {
  continue: "Continue",
  cancel: "Cancel",
  close: "Close",
  error: "Something went wrong",
  items: "{count} items",
  tooLong: "The text is too long",
};
type StringKey = keyof typeof STRINGS;

const DEFAULT_NOTICE_SECONDS = 5;
// The longest text taken, in Unicode code points (contract-protocol.md,
// Limits).
const MAX_TEXT_CHARS = 10000;
// How long the status region stays empty before a new text.
const ANNOUNCE_DELAY_MS = 100;

const STYLE = `
  :host {
    display: block;
  }
  [hidden] {
    display: none !important;
  }
  .view,
  .notice {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem;
    border: 1px solid #888;
    background: #fff;
    color: #222;
  }
  .text {
    flex: 1 1 12rem;
    /* An info keeps its paragraphs. */
    white-space: pre-line;
  }
  .label:empty {
    display: none;
  }
  .indicator {
    flex: none;
    box-sizing: border-box;
    width: 1rem;
    height: 1rem;
    border: 2px solid #888;
    border-top-color: #1a5fb4;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .indicator {
      animation: none;
    }
  }
  button {
    padding: 0.25rem 0.75rem;
    border: 1px solid #888;
    background: #fff;
    color: #222;
    font: inherit;
  }
  button:focus-visible,
  .notice:focus-visible {
    outline: 2px solid #1a5fb4;
    outline-offset: 2px;
  }
  /* For screen readers only. */
  .announcer {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
`;

export class DictaAction extends HTMLElement {
  // Set by the application; see specs/architecture.md (Element).
  // Declared only: a class field would wipe a value set before the element was
  // defined.
  declare module: CapabilityModule | undefined;
  declare getToken: (() => Promise<string>) | undefined;
  declare strings: Record<string, unknown> | undefined;

  // Carries the custom state with the view's name, for the page's CSS.
  #internals: ElementInternals;
  #view: HTMLDivElement;
  #notice: HTMLDivElement;
  // Announces to screen readers, separate from the visible parts.
  #announcer: HTMLDivElement;
  // The running request; a response for another one is ignored.
  #request: Request | undefined;
  // Kept between requests, so its token is kept too.
  #client: RoundClient | undefined;
  #clientFor:
    | {
        server: string | null;
        module: CapabilityModule | undefined;
        getToken: (() => Promise<string>) | undefined;
      }
    | undefined;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #noticeHovered = false;
  #noticeFocused = false;
  #announceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.#internals = this.attachInternals();
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.#view = document.createElement("div");
    this.#view.className = "view";
    this.#view.part.add("view");
    this.#view.hidden = true;
    this.#notice = document.createElement("div");
    this.#notice.className = "notice";
    this.#notice.part.add("notice");
    this.#notice.tabIndex = 0;
    this.#notice.hidden = true;
    // The notice stays while the pointer is over it or it has focus.
    this.#notice.addEventListener("pointerenter", () => {
      this.#noticeHovered = true;
      clearTimeout(this.#noticeTimer);
    });
    this.#notice.addEventListener("pointerleave", () => {
      this.#noticeHovered = false;
      this.#startNoticeTime();
    });
    this.#notice.addEventListener("focus", () => {
      this.#noticeFocused = true;
      clearTimeout(this.#noticeTimer);
    });
    this.#notice.addEventListener("blur", () => {
      this.#noticeFocused = false;
      this.#startNoticeTime();
    });
    this.#announcer = document.createElement("div");
    this.#announcer.className = "announcer";
    this.#announcer.setAttribute("role", "status");
    root.append(style, this.#view, this.#notice, this.#announcer);
  }

  submit(text: string) {
    const trimmed = text.trim();
    if (trimmed === "") {
      return;
    }
    if (Array.from(trimmed).length > MAX_TEXT_CHARS) {
      this.#showNotice(this.#string("tooLong"));
      return;
    }
    const request = this.#request;
    if (request === undefined) {
      this.#hideNotice();
      this.#request = { text: trimmed, exchange: [], added: [] };
      void this.#round(this.#request);
    } else if (request.question !== undefined) {
      this.#answer(request, trimmed);
    } else if (!request.confirming) {
      // The request is waiting for the server or running a plan (contract-
      // protocol.md, Added text and cancel).
      request.added.push(trimmed);
    }
  }

  // Moves the added texts into the exchange, each as its own item.
  #takeAdded(request: Request) {
    for (const added of request.added) {
      request.exchange.push({ added });
    }
    request.added = [];
  }

  // Sends the next round of the request and acts on its reply.
  async #round(request: Request) {
    this.#showWorking();
    let requestId: string;
    let reply: Reply;
    try {
      ({ requestId, reply } = await this.#roundClient().send({
        requestId: request.requestId,
        text: request.text,
        exchange: request.exchange,
      }));
    } catch (err) {
      if (this.#request === request) {
        this.#fail(request, err);
      }
      return;
    }
    if (this.#request !== request) {
      return;
    }
    request.requestId = requestId;
    if (request.added.length > 0) {
      if (reply.type === "plan" || reply.type === "question") {
        // Text came while waiting: the reply is dropped, and the next round
        // has the exchange as it was, followed by the added text.
        this.#takeAdded(request);
        void this.#round(request);
        return;
      }
      // After done, a stop or an info the request is over, and the held text
      // is given again: the first starts a new request.
      const held = request.added;
      request.added = [];
      this.#end(request, reply);
      for (const text of held) {
        this.submit(text);
      }
      return;
    }
    switch (reply.type) {
      case "question":
        request.question = reply.text;
        this.#showQuestion(request, reply.text, reply.options ?? []);
        break;
      case "plan":
        void this.#runPlan(request, reply.plan);
        break;
      default:
        this.#end(request, reply);
    }
  }

  // Ends the request with a done, a stop or an info.
  #end(request: Request, reply: Reply) {
    if (this.#request === request) {
      this.#request = undefined;
    }
    if (reply.type !== "plan" && reply.type !== "question") {
      this.#store(request, { type: reply.type, text: reply.text });
    }
    if (reply.type === "done") {
      this.#hideView();
      if (reply.text) {
        this.#showNotice(reply.text);
      }
    } else if (reply.type === "stop" || reply.type === "info") {
      this.#showEnd(reply.type, reply.text);
    }
  }

  // Checks and runs a plan, then reports it in the next round, whether it
  // finished or halted (contract-plan.md, Reporting).
  async #runPlan(request: Request, plan: unknown) {
    let report: Report;
    try {
      const client = this.#roundClient();
      report = this.#invalid(plan, client.context) ?? {};
      if (report.halt === undefined) {
        const { text } = plan as Plan;
        this.#showWorking(text);
        if (text) {
          this.#announce(text);
        }
        request.running = true;
        report = await runPlan(
          plan as Plan,
          client.module,
          (confirmation) => this.#ask(request, confirmation, text),
          () => {
            if (this.#request !== request) {
              return "cancelled";
            }
            return request.added.length > 0 ? "interrupted" : undefined;
          },
        );
      }
    } catch (err) {
      request.running = false;
      if (this.#request === request) {
        this.#fail(request, err);
      }
      return;
    }
    request.running = false;
    request.exchange.push({ plan, report });
    if (this.#request !== request) {
      // Cancelled while the plan ran: stored with this last report.
      this.#store(request, { type: "cancelled" });
      return;
    }
    // Text that came after the last step follows the report without a halt.
    this.#takeAdded(request);
    void this.#round(request);
  }

  // The report of a plan that fails the check: no step ran, so its halt has
  // no step (contract-protocol.md, Report).
  #invalid(plan: unknown, context: SiteContext): Report | undefined {
    try {
      checkPlan(plan, context);
      return undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { halt: { code: "invalid", message: cut(message) } };
    }
  }

  #answer(request: Request, answer: string) {
    const question = request.question;
    if (question === undefined || this.#request !== request) {
      return;
    }
    request.question = undefined;
    request.exchange.push({ question, answer });
    void this.#round(request);
  }

  #roundClient() {
    const server = this.getAttribute("server");
    const { module, getToken } = this;
    const last = this.#clientFor;
    if (
      !this.#client ||
      last?.server !== server ||
      last.module !== module ||
      last.getToken !== getToken
    ) {
      if (!server || !module) {
        throw new Error("the element needs its server and module");
      }
      this.#client = new RoundClient(server, module, getToken);
      this.#clientFor = { server, module, getToken };
    }
    return this.#client;
  }

  #fail(request: Request, err: unknown) {
    this.#request = undefined;
    this.#store(request, { type: "error" });
    // The message as text, since browsers print an error object differently.
    console.error(
      `dicta-action: ${err instanceof Error ? err.message : String(err)}`,
    );
    this.#showEnd("error", this.#string("error"));
  }

  // Ends the request. While a plan runs, the running step finishes first and
  // the request is stored with its last report (#runPlan).
  #cancel() {
    const request = this.#request;
    this.#request = undefined;
    this.#hideView();
    if (request !== undefined && !request.running) {
      this.#store(request, { type: "cancelled" });
    }
  }

  // Adds a finished request to the history, once. One without a requestId ran
  // nothing and is not stored (contract-capability.md, History).
  #store(request: Request, outcome: Outcome) {
    if (request.requestId === undefined) {
      return;
    }
    if (outcome.text === undefined) {
      delete outcome.text;
    }
    addHistory({
      requestId: request.requestId,
      time: localTime(new Date()),
      text: request.text,
      outcome,
      exchange: JSON.parse(JSON.stringify(request.exchange)) as unknown[],
    });
  }

  #string(key: StringKey) {
    const value =
      this.strings && Object.hasOwn(this.strings, key)
        ? this.strings[key]
        : undefined;
    return typeof value === "string" ? value : STRINGS[key];
  }

  // Shows the confirmation view and waits for Continue or Cancel. Continue
  // brings back the working view with the plan's label; Cancel ends the
  // request.
  #ask(request: Request, confirmation: Confirmation, label?: string) {
    return new Promise<boolean>((resolve) => {
      if (this.#request !== request) {
        resolve(false);
        return;
      }
      request.confirming = true;
      const texts = confirmation.items.map((item) => item.join("\n"));
      if (confirmation.count !== undefined) {
        texts.push(
          this.#string("items").replaceAll(
            "{count}",
            String(confirmation.count),
          ),
        );
      }
      const elements = texts.map((text) => {
        const element = document.createElement("div");
        element.className = "text";
        element.part.add("text");
        element.textContent = text;
        return element;
      });
      this.#setView("confirmation", [
        ...elements,
        this.#button("continue", () => {
          request.confirming = false;
          this.#showWorking(label);
          resolve(true);
        }),
        this.#button("cancel", () => {
          request.confirming = false;
          this.#cancel();
          resolve(false);
        }),
      ]);
      this.#announce(texts.join("\n"));
    });
  }

  #button(name: "continue" | "cancel" | "close", onClick: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.part.add(name);
    button.textContent = this.#string(name);
    button.addEventListener("click", onClick);
    return button;
  }

  #showWorking(text?: string) {
    const indicator = document.createElement("span");
    indicator.className = "indicator";
    indicator.part.add("indicator");
    indicator.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "label";
    label.part.add("label");
    label.textContent = text ?? "";
    this.#setView("working", [
      indicator,
      label,
      this.#button("cancel", () => this.#cancel()),
    ]);
  }

  #showQuestion(request: Request, text: string, options: string[]) {
    const element = document.createElement("div");
    element.className = "text";
    element.part.add("text");
    element.textContent = text;
    const buttons = options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.part.add("option");
      button.textContent = option;
      button.addEventListener("click", () => this.#answer(request, option));
      return button;
    });
    this.#setView("question", [
      element,
      ...buttons,
      this.#button("cancel", () => this.#cancel()),
    ]);
    this.#announce(text);
  }

  #showEnd(view: "stop" | "error" | "info", text: string) {
    const element = document.createElement("div");
    element.className = "text";
    element.part.add("text");
    element.textContent = text;
    this.#setView(view, [
      element,
      this.#button("close", () => this.#hideView()),
    ]);
    this.#announce(text);
  }

  // Shows a view in place of the one shown. When the focus was in the old
  // view, it moves to the new view's Cancel or Close.
  #setView(view: View, children: HTMLElement[]) {
    const hadFocus = this.#view.contains(
      this.shadowRoot?.activeElement ?? null,
    );
    this.#view.replaceChildren(...children);
    this.#view.hidden = false;
    this.#internals.states.clear();
    this.#internals.states.add(view);
    if (hadFocus) {
      this.#view
        .querySelector<HTMLButtonElement>('[part~="cancel"], [part~="close"]')
        ?.focus();
    }
  }

  #hideView() {
    this.#view.hidden = true;
    this.#view.replaceChildren();
    this.#internals.states.clear();
  }

  #showNotice(text: string) {
    this.#notice.textContent = text;
    this.#notice.hidden = false;
    this.#announce(text);
    this.#startNoticeTime();
  }

  #hideNotice() {
    clearTimeout(this.#noticeTimer);
    this.#notice.hidden = true;
    this.#notice.textContent = "";
    // A hidden notice does not reliably get blur (Firefox, WebKit) or
    // pointerleave.
    this.#noticeHovered = false;
    this.#noticeFocused = false;
  }

  // Starts the notice's time again, unless the pointer or the focus is on it.
  #startNoticeTime() {
    clearTimeout(this.#noticeTimer);
    if (this.#notice.hidden || this.#noticeHovered || this.#noticeFocused) {
      return;
    }
    this.#noticeTimer = setTimeout(
      () => this.#hideNotice(),
      this.#noticeSeconds() * 1000,
    );
  }

  #noticeSeconds() {
    const value = this.getAttribute("notice-duration") ?? "";
    const seconds = /^\d+$/.test(value) ? Number(value) : 0;
    return seconds >= 1 ? seconds : DEFAULT_NOTICE_SECONDS;
  }

  // Clears the status region first and sets the text a moment later, so a
  // text equal to the last one is announced again.
  #announce(text: string) {
    clearTimeout(this.#announceTimer);
    this.#announcer.textContent = "";
    this.#announceTimer = setTimeout(() => {
      this.#announcer.textContent = text;
    }, ANNOUNCE_DELAY_MS);
  }
}
