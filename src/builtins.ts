// The built-in capabilities, the same on every site, in the `dicta` group
// (contract-capability.md, Built-in capabilities). dicta.getHistory reads the
// history itself, so it does not depend on the <dicta-action> element.

import { OUTCOME_TYPES, readHistory } from "./history.ts";
import type { Capability, Schema } from "./module.ts";

const OUTCOME: Schema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [...OUTCOME_TYPES],
    },
    text: { type: "string" },
  },
};

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
    properties: {
      requestId: { type: "string" },
      time: { type: "string", description: "When the request ended" },
      text: { type: "string", description: "The user's request" },
      outcome: OUTCOME,
      exchange: { type: "array" },
    },
  },
  run: async (args) => {
    const entry = readHistory().find((e) => e.requestId === args.requestId);
    if (entry === undefined) {
      throw Object.assign(new Error("No such request"), { code: "not_found" });
    }
    // Stored as it is returned (specs/architecture.md, Storage).
    return entry;
  },
};

export const dictaCapabilities: Record<string, Capability> = {
  "dicta.getHistory": getHistory,
};
