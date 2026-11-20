import assert from "node:assert/strict";
import { test } from "node:test";
import { tabId } from "../src/tab.ts";
import { brokenStorage, FakeStorage } from "./storage.ts";

test("the tab id is 32 hex characters, kept in session storage", () => {
  const storage = new FakeStorage();
  Object.assign(globalThis, { sessionStorage: storage });
  const id = tabId();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(storage.items.get("dicta-action-tab-id"), JSON.stringify(id));
  assert.equal(tabId(), id);
});

test("each tab gets its own id", () => {
  Object.assign(globalThis, { sessionStorage: new FakeStorage() });
  const first = tabId();
  Object.assign(globalThis, { sessionStorage: new FakeStorage() });
  assert.notEqual(tabId(), first);
});

test("a stored id that is not a string is replaced", () => {
  const storage = new FakeStorage();
  storage.items.set("dicta-action-tab-id", "5");
  Object.assign(globalThis, { sessionStorage: storage });
  assert.match(tabId(), /^[0-9a-f]{32}$/);
});

test("storage that cannot be used gives one id in the page's memory", () => {
  Object.assign(globalThis, { sessionStorage: brokenStorage });
  const id = tabId();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(tabId(), id);
});
