// The built-in capabilities, the same on every site, in the `dicta` group
// (contract-capability.md, Built-in capabilities). They read the history
// themselves, so they do not depend on the <dicta-action> element.

import { type HistoryEntry, readHistory } from "./history.ts";
import type { Capability, Schema } from "./module.ts";
import { bytes, cut } from "./run.ts";

const DEFAULT_LIMIT = 10;
const MAX_OUTPUT_BYTES = 16 * 1024;

const OUTCOME: Schema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["done", "stop", "info", "cancelled", "error"],
    },
    text: { type: "string" },
  },
};

const ENTRY_PROPERTIES: Record<string, Schema> = {
  requestId: { type: "string" },
  time: { type: "string", description: "When the request ended" },
  text: { type: "string", description: "The user's request" },
  outcome: OUTCOME,
};

// The short entry of dicta.listHistory, with texts cut to 200 characters.
function short({ requestId, time, text, outcome }: HistoryEntry) {
  return {
    requestId,
    time,
    text: cut(text),
    outcome:
      outcome.text === undefined
        ? { type: outcome.type }
        : { type: outcome.type, text: cut(outcome.text) },
  };
}

type Report = {
  outputs?: Record<string, unknown>;
  tooLarge?: Record<string, number>;
  halt?: { outputs?: unknown; tooLarge?: number };
};

// Leaves out the outputs of every report, each into its report's tooLarge
// with its size; the plans, halts, questions, answers and texts stay.
function withoutOutputs(exchange: unknown[]) {
  return exchange.map((item) => {
    const { report } = item as { report?: Report };
    if (report === undefined) {
      return item;
    }
    const copy: Report = { ...report };
    if (copy.outputs !== undefined) {
      copy.tooLarge = { ...copy.tooLarge };
      for (const [step, output] of Object.entries(copy.outputs)) {
        copy.tooLarge[step] = bytes(output);
      }
      delete copy.outputs;
    }
    if (copy.halt?.outputs !== undefined) {
      const { outputs, ...halt } = copy.halt;
      copy.halt = { ...halt, tooLarge: bytes(outputs) };
    }
    return { ...(item as object), report: copy };
  });
}

function capabilityError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

const listHistory: Capability = {
  level: "read",
  desc:
    "Earlier requests of this browser tab, newest first, for requests that " +
    'refer to the past, such as "undo that" or "the same for Friday".',
  args: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "The most requests it returns, from 1; 10 when left out",
      },
    },
  },
  output: {
    type: "array",
    items: { type: "object", properties: ENTRY_PROPERTIES },
  },
  run: async (args) => {
    const limit = (args.limit as number | undefined) ?? DEFAULT_LIMIT;
    if (limit < 1) {
      throw new Error("limit must be 1 or more");
    }
    return readHistory().slice(0, limit).map(short);
  },
};

const getHistory: Capability = {
  level: "read",
  desc: "One earlier request of this browser tab in full, with its exchange.",
  args: {
    type: "object",
    properties: { requestId: { type: "string" } },
    required: ["requestId"],
  },
  output: {
    type: "object",
    properties: { ...ENTRY_PROPERTIES, exchange: { type: "array" } },
  },
  run: async (args) => {
    const entry = readHistory().find((e) => e.requestId === args.requestId);
    if (entry === undefined) {
      throw capabilityError("not_found", "No such request");
    }
    return bytes(entry) > MAX_OUTPUT_BYTES
      ? { ...entry, exchange: withoutOutputs(entry.exchange) }
      : entry;
  },
};

export const dictaCapabilities: Record<string, Capability> = {
  "dicta.listHistory": listHistory,
  "dicta.getHistory": getHistory,
};
