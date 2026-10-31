// The request saved when the page is left while it waits for a page load, for
// the next page to go on with (contract-protocol.md, Page changes).

const KEY = "dicta-action-saved";

type Saved = {
  // Milliseconds since 1970, for the 60 second check.
  savedAt: number;
  requestId: string;
  text: string;
  // Ends with the plan and its report, with the halt code `navigated` at the
  // first step that did not run, or no halt.
  exchange: unknown[];
  // Text the user added before the page load started.
  added: string[];
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
