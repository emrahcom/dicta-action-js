// One round with the server: build the body, send it and return the reply
// (contract-protocol.md, Round, Request body, Response body, Errors).

import { buildContext, type SiteContext } from "./context.ts";
import type { CapabilityModule } from "./module.ts";

export type Reply =
  | { type: "plan"; plan: unknown }
  | { type: "question"; text: string; options?: string[] }
  | { type: "done"; text?: string }
  | { type: "stop"; text: string }
  | { type: "info"; text: string };

const REPLY_TYPES = ["plan", "question", "done", "stop", "info"];

const TIMEOUT_MS = 60_000;

// A round that ends the request as an error. The message names the cause.
export class RoundError extends Error {}

export type Round = {
  requestId?: string;
  text: string;
  exchange: unknown[];
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// The local time to the second, with the offset as numbers, never Z.
export function localTime(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const local = new Date(date.getTime() + offset * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-` +
    `${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:` +
    `${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export class RoundClient {
  readonly #url: string;
  readonly #module: CapabilityModule;
  readonly #context: SiteContext;
  readonly #getToken: (() => Promise<string>) | undefined;
  #token: string | undefined;

  constructor(
    server: string,
    module: CapabilityModule,
    getToken?: () => Promise<string>,
  ) {
    this.#url = `${new URL(server).origin}/dicta-action/v1/round`;
    this.#module = module;
    this.#context = buildContext(module);
    this.#getToken = getToken;
  }

  // The module and the site context built from it, for running plans.
  get module() {
    return this.#module;
  }

  get context() {
    return this.#context;
  }

  async send(round: Round): Promise<{ requestId: string; reply: Reply }> {
    let state: Record<string, unknown>;
    try {
      state = await this.#module.state.run();
    } catch (err) {
      throw new RoundError(`state.run failed: ${message(err)}`, { cause: err });
    }
    const body = JSON.stringify({
      ...(round.requestId === undefined ? {} : { requestId: round.requestId }),
      text: round.text,
      time: localTime(new Date()),
      state,
      context: this.#context,
      exchange: round.exchange,
    });

    let response = await this.#post(body);
    if (response.status === 401 && this.#getToken) {
      this.#token = undefined;
      response = await this.#post(body);
    }
    return this.#read(response);
  }

  async #currentToken() {
    if (!this.#getToken) return undefined;
    if (this.#token === undefined) {
      try {
        this.#token = await this.#getToken();
      } catch (err) {
        throw new RoundError(`getToken failed: ${message(err)}`, {
          cause: err,
        });
      }
    }
    return this.#token;
  }

  async #post(body: string): Promise<{ status: number; json: unknown }> {
    const token = await this.#currentToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(this.#url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      return { status: response.status, json };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new RoundError("no response after 60 seconds", { cause: err });
      }
      throw new RoundError(`network failure: ${message(err)}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  #read({ status, json }: { status: number; json: unknown }) {
    const body = (json ?? {}) as Record<string, unknown>;
    if (status !== 200) {
      const error = typeof body.error === "string" ? `: ${body.error}` : "";
      throw new RoundError(`HTTP ${status}${error}`);
    }
    const reply = body.reply as Record<string, unknown> | null | undefined;
    if (
      typeof body.requestId !== "string" ||
      typeof reply !== "object" ||
      !reply
    ) {
      throw new RoundError("the response has no requestId or reply");
    }
    if (!REPLY_TYPES.includes(reply.type as string)) {
      throw new RoundError(`unknown reply type: ${String(reply.type)}`);
    }
    return { requestId: body.requestId, reply: reply as Reply };
  }
}
