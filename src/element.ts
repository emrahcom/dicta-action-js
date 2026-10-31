// The <dicta-action> element: it takes the user's text, runs the request with
// the server and shows what happens to it (specs/architecture.md).

import type { CapabilityModule } from "./module.ts";
import { type Reply, RoundClient } from "./round.ts";

type View = "working" | "question" | "confirmation" | "stop" | "error" | "info";

// A running user request (contract-protocol.md, Request body).
type Request = {
  text: string;
  requestId?: string;
  exchange: unknown[];
  // The text of the open question.
  question?: string;
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
    const request = this.#request;
    if (request === undefined) {
      this.#hideNotice();
      this.#request = { text: trimmed, exchange: [] };
      void this.#round(this.#request);
    } else if (request.question !== undefined) {
      this.#answer(request, trimmed);
    }
    // Otherwise the request is running; added text comes in its own task.
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
        this.#fail(err);
      }
      return;
    }
    if (this.#request !== request) {
      return;
    }
    request.requestId = requestId;
    switch (reply.type) {
      case "question":
        request.question = reply.text;
        this.#showQuestion(request, reply.text, reply.options ?? []);
        break;
      case "done":
        this.#request = undefined;
        this.#hideView();
        if (reply.text) {
          this.#showNotice(reply.text);
        }
        break;
      case "stop":
      case "info":
        this.#request = undefined;
        this.#showEnd(reply.type, reply.text);
        break;
      default:
        // Plans come in their own task.
        this.#fail(new Error(`${reply.type} replies are not supported yet`));
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

  #fail(err: unknown) {
    this.#request = undefined;
    // The message as text, since browsers print an error object differently.
    console.error(
      `dicta-action: ${err instanceof Error ? err.message : String(err)}`,
    );
    this.#showEnd("error", this.#string("error"));
  }

  #cancel() {
    this.#request = undefined;
    this.#hideView();
  }

  #string(key: StringKey) {
    const value =
      this.strings && Object.hasOwn(this.strings, key)
        ? this.strings[key]
        : undefined;
    return typeof value === "string" ? value : STRINGS[key];
  }

  #button(name: "cancel" | "close", onClick: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.part.add(name);
    button.textContent = this.#string(name);
    button.addEventListener("click", onClick);
    return button;
  }

  #showWorking() {
    const indicator = document.createElement("span");
    indicator.className = "indicator";
    indicator.part.add("indicator");
    indicator.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "label";
    label.part.add("label");
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

  #announce(text: string) {
    this.#announcer.textContent = text;
  }
}
