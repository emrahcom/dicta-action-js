// The tab id: a random id for the browser tab, kept in its session storage,
// or in the page's memory when the storage cannot be used
// (specs/architecture.md, Storage; contract-protocol.md, Request body).

const KEY = "dicta-action-tab-id";

let inMemory: string | undefined;

// 16 random bytes in hex. getRandomValues works without HTTPS too.
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function tabId(): string {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (typeof stored === "string") {
      return stored;
    }
    const id = newId();
    sessionStorage.setItem(KEY, JSON.stringify(id));
    return id;
  } catch {
    inMemory ??= newId();
    return inMemory;
  }
}
