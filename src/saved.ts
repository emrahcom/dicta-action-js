// The request saved when the page is left while a step runs, for the next
// page to go on with (contract-protocol.md, Page changes).

import type { Report } from "./run.ts";

const KEY = "dicta-action-saved";

type Saved = {
  // Milliseconds since 1970, for the 60 second check.
  savedAt: number;
  requestId: string;
  text: string;
  exchange: unknown[];
  plan: unknown;
  // The report so far, with the halt code `navigated` at the running step.
  report: Report;
};

export function saveRequest(saved: Saved) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage that cannot be used: the request cannot go on.
  }
}

// Takes the saved request out, so it goes on at most once.
export function takeSaved(): Saved | undefined {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return value === null ? undefined : (JSON.parse(value) as Saved);
  } catch {
    return undefined;
  }
}
