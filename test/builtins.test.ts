import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { dictaCapabilities } from "../src/builtins.ts";
import {
  addHistory,
  type HistoryEntry,
  readHistory,
  shortHistory,
} from "../src/history.ts";
import { saveRequest, takeSaved } from "../src/saved.ts";

// A small session storage for Node, with an optional limit on the length of
// all its values together.
class FakeStorage {
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

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  Object.assign(globalThis, { sessionStorage: storage });
});

function entry(n: number, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    requestId: `r${n}`,
    time: "2026-10-29T10:15:00+01:00",
    text: `request ${n}`,
    outcome: { type: "done", text: `Done ${n}` },
    exchange: [],
    ...extra,
  };
}

const get = dictaCapabilities["dicta.getHistory"];

test("the only built-in is dicta.getHistory, a read capability with schemas", () => {
  assert.deepEqual(Object.keys(dictaCapabilities), ["dicta.getHistory"]);
  assert.equal(get.level, "read");
  assert.match(get.desc, /requestId of its history entry/);
  assert.equal(get.args?.type, "object");
  assert.notEqual(get.output, undefined);
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
  Object.assign(globalThis, {
    sessionStorage: {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
    },
  });
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
  Object.assign(globalThis, {
    sessionStorage: {
      getItem() {
        throw new Error("SecurityError");
      },
    },
  });
  assert.deepEqual(shortHistory(), []);
});

test("getHistory returns a request in full", async () => {
  const full = entry(1, {
    text: "a".repeat(300),
    exchange: [{ plan: { steps: [] }, report: { outputs: { 1: "x" } } }],
  });
  addHistory(full);
  assert.deepEqual(await get.run({ requestId: "r1" }), full);
});

test("getHistory fails with not_found for an unknown id", async () => {
  await assert.rejects(get.run({ requestId: "r9" }), {
    code: "not_found",
  });
});

test("getHistory leaves out report outputs over 16 KB", async () => {
  const big = "a".repeat(9000);
  addHistory(
    entry(1, {
      exchange: [
        {
          plan: { steps: [] },
          report: {
            outputs: { 1: big, 2: big },
            tooLarge: { 3: 5 },
            halt: { step: 4, code: "x", message: "m", outputs: [[big]] },
          },
        },
        { question: "Which?", answer: "This" },
      ],
    }),
  );
  const result = (await get.run({ requestId: "r1" })) as HistoryEntry;
  assert.deepEqual(result.exchange, [
    {
      plan: { steps: [] },
      report: {
        tooLarge: { 1: 9002, 2: 9002, 3: 5 },
        halt: { step: 4, code: "x", message: "m", tooLarge: 9006 },
      },
    },
    { question: "Which?", answer: "This" },
  ]);
});
