import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addHistory, readHistory, shortHistory } from "../src/history.ts";
import { saveRequest, takeSaved } from "../src/saved.ts";
import { brokenStorage, entry, FakeStorage } from "./storage.ts";

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  Object.assign(globalThis, { sessionStorage: storage });
});

test("the history is oldest first and keeps at most 20", () => {
  for (let n = 1; n <= 22; n++) {
    addHistory(entry(n));
  }
  const kept = readHistory();
  assert.equal(kept.length, 20);
  assert.equal(kept[0].requestId, "r3");
  assert.equal(kept[19].requestId, "r22");
});

test("when storage is full, the oldest go first", () => {
  addHistory(entry(1));
  addHistory(entry(2));
  storage.limit = JSON.stringify([entry(2), entry(3)]).length;
  addHistory(entry(3));
  assert.deepEqual(
    readHistory().map((e) => e.requestId),
    ["r2", "r3"],
  );
});

test("the oldest history requests make room for the saved request", () => {
  for (let n = 1; n <= 5; n++) {
    addHistory(entry(n, { exchange: [{ added: "x".repeat(100) }] }));
  }
  const saved = {
    savedAt: 1,
    requestId: "r6",
    text: "go on",
    exchange: [{ added: "y".repeat(600) }],
    added: [],
  };
  // The five history requests fit, but not with the saved request; three do.
  storage.limit =
    JSON.stringify(saved).length +
    JSON.stringify(readHistory().slice(-3)).length;
  assert.ok(storage.limit >= JSON.stringify(readHistory()).length);
  saveRequest(saved);
  assert.deepEqual(
    readHistory().map((e) => e.requestId),
    ["r3", "r4", "r5"],
  );
  assert.deepEqual(takeSaved(), saved);
});

test("storage that cannot be used gives an empty history", () => {
  Object.assign(globalThis, { sessionStorage: brokenStorage });
  assert.doesNotThrow(() => addHistory(entry(1)));
  assert.deepEqual(readHistory(), []);
});

test("the short history is oldest first, short fields first, texts cut to 200", () => {
  addHistory(
    entry(1, {
      text: "\u{1F600}".repeat(300),
      outcome: { type: "stop", text: "b".repeat(300) },
      exchange: [{ added: "x" }],
    }),
  );
  addHistory(entry(2, { outcome: { type: "cancelled" } }));
  const result = shortHistory();
  assert.equal(
    JSON.stringify(result[1]),
    '{"requestId":"r2","time":"2026-10-29T10:15:00+01:00",' +
      '"outcome":{"type":"cancelled"},"text":"request 2"}',
  );
  assert.deepEqual(result[0], {
    requestId: "r1",
    time: "2026-10-29T10:15:00+01:00",
    outcome: { type: "stop", text: "b".repeat(200) },
    text: "\u{1F600}".repeat(200),
  });
});

test("the short history is empty without a history or storage", () => {
  assert.deepEqual(shortHistory(), []);
  Object.assign(globalThis, { sessionStorage: brokenStorage });
  assert.deepEqual(shortHistory(), []);
});
