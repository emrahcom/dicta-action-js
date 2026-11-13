import assert from "node:assert/strict";
import { test } from "node:test";
import { tabId } from "../src/tab.ts";

function storage(items = new Map<string, string>()) {
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const broken = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
};

test("the tab id is 32 hex characters, kept in session storage", () => {
  const items = new Map<string, string>();
  Object.assign(globalThis, { sessionStorage: storage(items) });
  const id = tabId();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(items.get("dicta-action-tab-id"), JSON.stringify(id));
  assert.equal(tabId(), id);
});

test("each tab gets its own id", () => {
  Object.assign(globalThis, { sessionStorage: storage() });
  const first = tabId();
  Object.assign(globalThis, { sessionStorage: storage() });
  assert.notEqual(tabId(), first);
});

test("a stored id that is not a string is replaced", () => {
  const items = new Map([["dicta-action-tab-id", "5"]]);
  Object.assign(globalThis, { sessionStorage: storage(items) });
  assert.match(tabId(), /^[0-9a-f]{32}$/);
});

test("storage that cannot be used gives one id in the page's memory", () => {
  Object.assign(globalThis, { sessionStorage: broken });
  const id = tabId();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(tabId(), id);
});
