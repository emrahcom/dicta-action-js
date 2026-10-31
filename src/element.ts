// The <dicta-action> element: it takes the user's text, runs the request with
// the server and shows what happens to it (specs/architecture.md).

import type { SiteContext } from "./context.ts";
import type { CapabilityModule } from "./module.ts";
import { checkPlan, type Plan } from "./plan.ts";
import { addHistory, type Outcome } from "./history.ts";
import { localTime, type Reply, RoundClient } from "./round.ts";
import {
  type Confirmation,
  cut,
  newProgress,
  type Progress,
  type Report,
  reportSoFar,
  runPlan,
  STOP_MESSAGES,
} from "./run.ts";
import { saveRequest, takeSaved } from "./saved.ts";

type View = "working" | "question" | "confirmation";

// Where a running request is: waiting for the server, a question open, a plan
// running, a confirmation open in that plan, or waiting for the page to be
// left after a page load started during a step.
type Phase = "waiting" | "question" | "running" | "confirmation" | "pageLoad";

// A running user request (contract-protocol.md, Request body).
type Request = {
  text: string;
  requestId?: string;
  exchange: unknown[];
  phase: Phase;
  // The text of the open question, for its answer.
  question?: string;
  // Text the user added that is not in the exchange yet.
  added: string[];
  // The running plan and where it is, for a page change.
  plan?: unknown;
  progress?: Progress;
  // Set when a page load started while the plan ran; text is then ignored
  // (contract-protocol.md, Page changes).
  pageLoad?: boolean;
  // Set when the page was left; the request is saved or stored already.
  left?: boolean;
};

// While a plan runs, also with a confirmation open; a cancel then waits for
// its last report.
function planRuns(request: Request) {
  return request.phase === "running" || request.phase === "confirmation";
}

// A saved request older than this ends instead of going on.
const SAVED_MS = 60_000;
// A round that fails while the page is being left waits this long for
// pagehide; the navigation may be called off.
const LEAVING_MS = 1000;

// The element's own strings (specs/architecture.md, Strings).
const STRINGS = {
  continue: "Continue",
  cancel: "Cancel",
  close: "Close",
  // Announced only, never shown (specs/architecture.md, Accessibility).
  done: "Done",
  error: "Something went wrong",
  // Announced only, never shown.
  info: "New information",
  items: "{count} items",
  pageLoad: "Wait for the page to load",
  tooLong: "The text is too long",
  // Announced only, never shown.
  working: "Working",
};
type StringKey = keyof typeof STRINGS;

const DEFAULT_NOTICE_SECONDS = 5;
// The most notices shown at once.
const MAX_NOTICES = 3;
// The reading time of a notice: one second for every this many words.
const WORDS_PER_SECOND = 3;
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
  .notices {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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

// The browser's Navigation API, when it has one.
function navigationApi(): EventTarget | undefined {
  return (window as unknown as { navigation?: EventTarget }).navigation;
}

export class DictaAction extends HTMLElement {
  // Set by the application; see specs/architecture.md (Element).
  // Declared only: a class field would wipe a value set before the element was
  // defined.
  declare getToken: (() => Promise<string>) | undefined;
  declare strings: Record<string, unknown> | undefined;

  // Carries the custom state with the view's name, for the page's CSS.
  #internals: ElementInternals;
  #view: HTMLDivElement;
  // The notices shown, the newest last (specs/architecture.md, Display).
  #notices: HTMLDivElement;
  // The notices with a Close button, which never go away by themselves.
  #infos = new WeakSet<HTMLElement>();
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
  #announceTimer: ReturnType<typeof setTimeout> | undefined;
  // The texts waiting to be set in the status region.
  #announcePending: string[] = [];
  // The page element the focus came from into the element, to go back to.
  #focusFrom: HTMLElement | undefined;

  static observedAttributes = ["server"];

  #module: CapabilityModule | undefined;

  // Setting the module may let a saved request go on (#resume).
  get module() {
    return this.#module;
  }

  set module(module: CapabilityModule | undefined) {
    this.#module = module;
    this.#resume();
  }

  constructor() {
    super();
    // A module set before the element was defined is an own property that
    // hides the accessor; it moves into the accessor.
    if (Object.hasOwn(this, "module")) {
      const module = Reflect.get(this, "module") as CapabilityModule;
      Reflect.deleteProperty(this, "module");
      this.#module = module;
    }
    this.#internals = this.attachInternals();
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.#view = document.createElement("div");
    this.#view.className = "view";
    this.#view.part.add("view");
    this.#view.hidden = true;
    this.#notices = document.createElement("div");
    this.#notices.className = "notices";
    root.addEventListener("focusin", (event) => {
      const from = (event as FocusEvent).relatedTarget;
      // Only a page element outside counts, not one in the shadow root.
      if (
        from instanceof HTMLElement &&
        !this.contains(from) &&
        !root.contains(from)
      ) {
        this.#focusFrom = from;
      }
    });
    this.#announcer = document.createElement("div");
    this.#announcer.className = "announcer";
    this.#announcer.setAttribute("role", "status");
    root.append(style, this.#view, this.#notices, this.#announcer);
  }

  connectedCallback() {
    window.addEventListener("beforeunload", this.#onBeforeUnload);
    window.addEventListener("pagehide", this.#onPageHide);
    window.addEventListener("pageshow", this.#onPageShow);
    navigationApi()?.addEventListener("navigate", this.#onNavigate);
    this.#resume();
  }

  disconnectedCallback() {
    window.removeEventListener("beforeunload", this.#onBeforeUnload);
    window.removeEventListener("pagehide", this.#onPageHide);
    window.removeEventListener("pageshow", this.#onPageShow);
    navigationApi()?.removeEventListener("navigate", this.#onNavigate);
  }

  // A page load, to another document, that starts while a plan runs
  // (specs/architecture.md, Plan runner). Without the Navigation API it is not
  // seen.
  #onNavigate = (event: Event) => {
    const request = this.#request;
    const { destination } = event as Event & {
      destination: { sameDocument: boolean };
    };
    if (request?.phase === "running" && !destination.sameDocument) {
      request.pageLoad = true;
    }
  };

  // Browsers abort a pending round when a page load starts, after
  // beforeunload and before pagehide; that is a page change, not an error.
  #leaving = false;

  #onBeforeUnload = () => {
    this.#leaving = true;
  };

  attributeChangedCallback() {
    this.#resume();
  }

  #onPageHide = () => {
    // The page load has happened: a later failed round is an error at once.
    this.#leaving = false;
    const request = this.#request;
    if (request !== undefined) {
      this.#request = undefined;
      request.left = true;
      this.#leave(request);
    }
    // A page the browser shows again from its back/forward cache shows no
    // request that is over.
    this.#hideView();
    this.#notices.replaceChildren();
  };

  // A page shown again from the back/forward cache does not start again, so
  // it looks for a saved request here (contract-protocol.md, Page changes).
  #onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      this.#resume();
    }
  };

  // The page is left in the middle of a request: it goes on in the new page
  // only if it waits for this page load; otherwise it ends as cancelled, with
  // everything done so far (contract-protocol.md, Page changes).
  #leave(request: Request) {
    if (request.phase === "pageLoad" && request.requestId !== undefined) {
      saveRequest({
        savedAt: Date.now(),
        requestId: request.requestId,
        text: request.text,
        exchange: request.exchange,
        added: request.added,
      });
      return;
    }
    const { progress, plan } = request;
    if (progress !== undefined && planRuns(request)) {
      // A report not sent yet goes into the history too.
      request.exchange.push({
        plan,
        report: reportSoFar(progress, "cancelled", STOP_MESSAGES.cancelled),
      });
    }
    this.#store(request, { type: "cancelled" });
  }

  // Takes a saved request out once the element has its server and module. A
  // recent one goes on with its report and added text in the next round, which
  // sends the new page's state; an older one ends as cancelled.
  #resume() {
    if (
      this.#request !== undefined ||
      !this.getAttribute("server") ||
      this.#module === undefined
    ) {
      return;
    }
    const saved = takeSaved();
    if (saved === undefined) {
      return;
    }
    const request: Request = {
      text: saved.text,
      requestId: saved.requestId,
      exchange: [...saved.exchange],
      phase: "waiting",
      added: saved.added,
    };
    this.#takeAdded(request);
    if (Date.now() - saved.savedAt > SAVED_MS) {
      this.#store(request, { type: "cancelled" });
      return;
    }
    this.#request = request;
    this.#announce(this.#string("working"));
    void this.#round(request);
  }

  submit(text: string) {
    const trimmed = text.trim();
    if (trimmed === "") {
      return;
    }
    if (Array.from(trimmed).length > MAX_TEXT_CHARS) {
      this.#addNotice(this.#string("tooLong"));
      return;
    }
    const request = this.#request;
    if (request?.pageLoad) {
      // From the start of a page load until the page is left, text is ignored;
      // the working view says why (contract-protocol.md, Page changes).
      return;
    }
    if (request === undefined) {
      this.#request = {
        text: trimmed,
        exchange: [],
        phase: "waiting",
        added: [],
      };
      this.#announce(this.#string("working"));
      void this.#round(this.#request);
    } else if (request.phase === "question") {
      this.#answer(request, trimmed);
    } else if (request.phase !== "confirmation") {
      // The request is waiting for the server or running a plan (contract-
      // protocol.md, Added text and cancel). During a confirmation, text is
      // ignored.
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
    request.phase = "waiting";
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
      if (this.#leaving) {
        // pagehide ends the request; when the page stays, it is an error.
        setTimeout(() => {
          this.#leaving = false;
          if (this.#request === request) {
            this.#fail(request, err);
          }
        }, LEAVING_MS);
      } else if (this.#request === request) {
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
        request.phase = "question";
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
    if (reply.type === "plan" || reply.type === "question") {
      return;
    }
    // The outcome is a notice; a new request does not hide it.
    this.#hideView();
    if (reply.type === "info") {
      this.#addNotice(reply.text, true);
    } else if (reply.text) {
      this.#addNotice(reply.text);
    } else {
      this.#announce(this.#string("done"));
    }
  }

  // Checks and runs a plan, then reports it in the next round, whether it
  // finished or halted (contract-plan.md, Reporting).
  async #runPlan(request: Request, plan: unknown) {
    request.phase = "running";
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
        request.plan = plan;
        request.progress = newProgress();
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
          request.progress,
          async () => {
            // WebKit fires navigate for location.reload() a task later.
            await new Promise((resolve) => setTimeout(resolve, 0));
            return this.#request === request && request.pageLoad === true;
          },
        );
      }
    } catch (err) {
      request.plan = undefined;
      request.progress = undefined;
      if (this.#request === request) {
        this.#fail(request, err);
      }
      return;
    }
    request.plan = undefined;
    request.progress = undefined;
    request.exchange.push({ plan, report });
    if (this.#request !== request) {
      // Cancelled while the plan ran: stored with this last report.
      if (!request.left) {
        this.#store(request, { type: "cancelled" });
      }
      return;
    }
    if (request.pageLoad) {
      // The report waits, with the working view, for the page to be left.
      request.phase = "pageLoad";
      const label = this.#string("pageLoad");
      this.#showWorking(label);
      this.#announce(label);
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
    if (
      request.phase !== "question" ||
      question === undefined ||
      this.#request !== request
    ) {
      return;
    }
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
    this.#hideView();
    this.#addNotice(this.#string("error"));
  }

  // Ends the request. While a plan runs, the running step finishes first and
  // the request is stored with its last report (#runPlan). While it waits for
  // a page load, it is stored with the report it holds and its added text.
  #cancel() {
    const request = this.#request;
    this.#request = undefined;
    this.#hideView();
    if (request !== undefined && !planRuns(request)) {
      if (request.phase === "pageLoad") {
        this.#takeAdded(request);
      }
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
      request.phase = "confirmation";
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
          request.phase = "running";
          this.#showWorking(label);
          resolve(true);
        }),
        this.#button("cancel", () => {
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
    // With its options, so a screen reader user knows they are there.
    this.#announce([text, ...options].join("\n"));
  }

  // Shows a view in place of the one shown. When the focus was in the old
  // view, it moves to the new view's Cancel.
  #setView(view: View, children: HTMLElement[]) {
    const hadFocus = this.#view.contains(
      this.shadowRoot?.activeElement ?? null,
    );
    this.#view.replaceChildren(...children);
    this.#view.hidden = false;
    this.#internals.states.clear();
    this.#internals.states.add(view);
    if (hadFocus) {
      this.#view.querySelector<HTMLButtonElement>('[part~="cancel"]')?.focus();
    }
  }

  // Hides the view. When the focus was in it, it goes back to the page element
  // it came from, or to the element itself when that one is gone.
  #hideView() {
    const hadFocus = this.#view.contains(
      this.shadowRoot?.activeElement ?? null,
    );
    this.#view.hidden = true;
    this.#view.replaceChildren();
    this.#internals.states.clear();
    if (hadFocus) {
      this.#returnFocus();
    }
  }

  // Gives the focus back to the page element it came from into the element,
  // or to the element itself when that one is gone.
  #returnFocus() {
    const from = this.#focusFrom;
    if (from?.isConnected) {
      from.focus();
    }
    if (!from?.matches(":focus")) {
      this.tabIndex = -1;
      this.focus();
    }
  }

  // Shows a notice after the ones shown. An info has its paragraphs and Close
  // and stays until closed; any other notice goes away by itself. With more
  // than three, the oldest that goes away by itself goes first.
  #addNotice(text: string, info = false) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.part.add("notice");
    notice.tabIndex = 0;
    if (info) {
      const element = document.createElement("div");
      element.className = "text";
      element.textContent = text;
      notice.append(
        element,
        this.#button("close", () => this.#removeNotice(notice)),
      );
      this.#infos.add(notice);
      // An info can be long: only the info string is announced.
      this.#announce(this.#string("info"));
    } else {
      notice.textContent = text;
      this.#timeNotice(notice, text);
      this.#announce(text);
    }
    const shown = Array.from(this.#notices.children) as HTMLElement[];
    if (shown.length >= MAX_NOTICES) {
      const oldest = shown.find((element) => !this.#infos.has(element));
      if (oldest) {
        this.#removeNotice(oldest);
      }
    }
    this.#notices.append(notice);
  }

  // A notice that goes away by itself: after notice-duration or its reading
  // time, whichever is longer. While the pointer is over it or it has focus,
  // it stays, and the time starts again when they leave.
  #timeNotice(notice: HTMLElement, text: string) {
    const words = text.split(/\s+/).filter(Boolean).length;
    const ms =
      Math.max(this.#noticeSeconds(), Math.ceil(words / WORDS_PER_SECOND)) *
      1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovered = false;
    let focused = false;
    const start = () => {
      clearTimeout(timer);
      if (!hovered && !focused) {
        timer = setTimeout(() => this.#removeNotice(notice), ms);
      }
    };
    notice.addEventListener("pointerenter", () => {
      hovered = true;
      start();
    });
    notice.addEventListener("pointerleave", () => {
      hovered = false;
      start();
    });
    notice.addEventListener("focus", () => {
      focused = true;
      start();
    });
    notice.addEventListener("blur", () => {
      focused = false;
      start();
    });
    start();
  }

  // Removes a notice. When the focus was in it, it goes back (#returnFocus).
  #removeNotice(notice: HTMLElement) {
    if (!notice.isConnected) {
      return;
    }
    const hadFocus = notice.contains(this.shadowRoot?.activeElement ?? null);
    notice.remove();
    if (hadFocus) {
      this.#returnFocus();
    }
  }

  #noticeSeconds() {
    const value = this.getAttribute("notice-duration") ?? "";
    const seconds = /^\d+$/.test(value) ? Number(value) : 0;
    return seconds >= 1 ? seconds : DEFAULT_NOTICE_SECONDS;
  }

  // Clears the status region first and sets the text a moment later, so a
  // text equal to the last one is announced again. A text that is still
  // waiting is set together with the new one, never replaced by it.
  #announce(text: string) {
    clearTimeout(this.#announceTimer);
    this.#announcePending.push(text);
    this.#announcer.textContent = "";
    this.#announceTimer = setTimeout(() => {
      this.#announcer.textContent = this.#announcePending.join("\n");
      this.#announcePending = [];
    }, ANNOUNCE_DELAY_MS);
  }
}
