// The built-in capabilities, the same on every site, in the `dicta` group
// (contract-capability.md, Built-in capabilities). dicta.getHistory reads the
// history itself, so it does not depend on the <dicta-action> element.

import { readHistory } from "./history.ts";
import type { Capability, Schema } from "./module.ts";
import { bytes } from "./run.ts";

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

const getHistory: Capability = {
  level: "read",
  desc:
    "One earlier request of this browser tab in full, with its exchange, " +
    "by the requestId of its history entry.",
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
  "dicta.getHistory": getHistory,
};
