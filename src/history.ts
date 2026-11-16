// The history: the finished requests of the browser tab, kept in its session
// storage (specs/architecture.md, Storage; contract-protocol.md, History).

import { bytes, cut, type Report } from "./run.ts";

const KEY = "dicta-action-history";
const MAX_REQUESTS = 20;

export type Outcome = {
  type: "done" | "stop" | "info" | "cancelled" | "error";
  text?: string;
};

export type HistoryEntry = {
  requestId: string;
  time: string;
  text: string;
  outcome: Outcome;
  exchange: unknown[];
};

// The kept requests, oldest first. Storage that cannot be read gives none.
export function readHistory(): HistoryEntry[] {
  try {
    const list: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? (list as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// The most dicta.getHistory returns (contract-capability.md,
// dicta.getHistory).
const MAX_ENTRY_BYTES = 16 * 1024;

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

// Adds a finished request, as dicta.getHistory returns it: over 16 KB, with
// its outputs replaced by their sizes (specs/architecture.md, Storage). When
// storage is full, the oldest requests go first; storage that cannot be used
// is left alone.
export function addHistory(entry: HistoryEntry) {
  const stored =
    bytes(entry) > MAX_ENTRY_BYTES
      ? { ...entry, exchange: withoutOutputs(entry.exchange) }
      : entry;
  const list = [...readHistory(), stored].slice(-MAX_REQUESTS);
  while (list.length > 0) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(list));
      return;
    } catch {
      list.shift();
    }
  }
}

// Drops the oldest request, to make room in storage. False when none is left
// or storage cannot be used.
export function dropOldestHistory() {
  const list = readHistory();
  if (list.length === 0) {
    return false;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list.slice(1)));
    return true;
  } catch {
    return false;
  }
}

// The history a round sends: a short entry for each kept request, oldest
// first, its short fields first and its texts cut to 200 characters
// (contract-protocol.md, History).
export function shortHistory() {
  return readHistory().map(({ requestId, time, outcome, text }) => ({
    requestId,
    time,
    outcome:
      outcome.text === undefined
        ? { type: outcome.type }
        : { type: outcome.type, text: cut(outcome.text) },
    text: cut(text),
  }));
}
