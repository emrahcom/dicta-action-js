// Session storage for the unit tests, which run in Node, and a history entry
// to keep in it.

import type { HistoryEntry } from "../src/history.ts";

// A small session storage, with an optional limit on the length of all its
// values together.
export class FakeStorage {
  items = new Map<string, string>();
  limit = Infinity;
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    let used = value.length;
    for (const [other, kept] of this.items) {
      used += other === key ? 0 : kept.length;
    }
    if (used > this.limit) {
      throw new Error("QuotaExceededError");
    }
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

// Session storage that cannot be used, for example with blocked site data.
export const brokenStorage = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
};

export function entry(
  n: number,
  extra: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    requestId: `r${n}`,
    time: "2026-10-29T10:15:00+01:00",
    text: `request ${n}`,
    outcome: { type: "done", text: `Done ${n}` },
    exchange: [],
    ...extra,
  };
}
