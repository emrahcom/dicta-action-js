// The history: the finished requests of the browser tab, kept in its session
// storage (specs/architecture.md, Storage; contract-capability.md, History).

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

// The kept requests, newest first. Storage that cannot be read gives none.
export function readHistory(): HistoryEntry[] {
  try {
    const list: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? (list as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// Adds a finished request. When storage is full, the oldest requests go
// first; storage that cannot be used is left alone.
export function addHistory(entry: HistoryEntry) {
  const list = [entry, ...readHistory()].slice(0, MAX_REQUESTS);
  while (list.length > 0) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(list));
      return;
    } catch {
      list.pop();
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
    sessionStorage.setItem(KEY, JSON.stringify(list.slice(0, -1)));
    return true;
  } catch {
    return false;
  }
}
