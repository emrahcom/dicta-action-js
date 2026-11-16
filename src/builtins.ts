// The built-in capabilities, the same on every site, in the `dicta` group
// (contract-capability.md, Built-in capabilities). dicta.getHistory reads the
// history itself, so it does not depend on the <dicta-action> element.

import { readHistory } from "./history.ts";
import type { Capability, Schema } from "./module.ts";

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
    // Stored as it is returned (specs/architecture.md, Storage).
    return entry;
  },
};

export const dictaCapabilities: Record<string, Capability> = {
  "dicta.getHistory": getHistory,
};
