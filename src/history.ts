// The history: the finished requests of the browser tab, kept in its session
// storage (specs/architecture.md, Storage; contract-protocol.md, History).

import { withSmallOutputs } from "./exchange.ts";
import { cut } from "./run.ts";

const KEY = "dicta-action-history";
const MAX_REQUESTS = 20;

// How a request ended (contract-protocol.md, History).
export const OUTCOME_TYPES = [
  "done",
  "stop",
  "info",
  "cancelled",
  "error",
] as const;

export type Outcome = {
  type: (typeof OUTCOME_TYPES)[number];
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

// Adds a finished request, with every output over 512 bytes moved into
// tooLarge, in the last two plans too (specs/architecture.md, Storage). When
// storage is full, the oldest requests go first; storage that cannot be used
// is left alone.
export function addHistory(entry: HistoryEntry) {
  const stored = { ...entry, exchange: entry.exchange.map(withSmallOutputs) };
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
