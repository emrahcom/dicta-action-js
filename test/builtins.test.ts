import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { dictaCapabilities } from "../src/builtins.ts";
import { addHistory, type HistoryEntry, readHistory } from "../src/history.ts";
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

const list = dictaCapabilities["dicta.listHistory"];
const get = dictaCapabilities["dicta.getHistory"];

test("the built-ins are read capabilities with schemas", () => {
  for (const capability of [list, get]) {
    assert.equal(capability.level, "read");
    assert.equal(typeof capability.desc, "string");
    assert.equal(capability.args?.type, "object");
    assert.notEqual(capability.output, undefined);
  }
});

test("the history is newest first and keeps at most 20", () => {
  for (let n = 1; n <= 22; n++) {
    addHistory(entry(n));
  }
  const kept = readHistory();
  assert.equal(kept.length, 20);
  assert.equal(kept[0].requestId, "r22");
  assert.equal(kept[19].requestId, "r3");
});

test("when storage is full, the oldest go first", () => {
  addHistory(entry(1));
  addHistory(entry(2));
  storage.limit = JSON.stringify([entry(3), entry(2)]).length;
  addHistory(entry(3));
  assert.deepEqual(
    readHistory().map((e) => e.requestId),
    ["r3", "r2"],
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
    JSON.stringify(readHistory().slice(0, 3)).length;
  assert.ok(storage.limit >= JSON.stringify(readHistory()).length);
  saveRequest(saved);
  assert.deepEqual(
    readHistory().map((e) => e.requestId),
    ["r5", "r4", "r3"],
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

test("listHistory returns 10 short entries by default", async () => {
  for (let n = 1; n <= 12; n++) {
    addHistory(entry(n, { exchange: [{ added: "x" }] }));
  }
  const result = (await list.run({})) as unknown[];
  assert.equal(result.length, 10);
  assert.deepEqual(result[0], {
    requestId: "r12",
    time: "2026-10-29T10:15:00+01:00",
    text: "request 12",
    outcome: { type: "done", text: "Done 12" },
  });
});

test("listHistory takes a limit and cuts texts to 200", async () => {
  addHistory(
    entry(1, {
      text: "a".repeat(300),
      outcome: { type: "stop", text: "b".repeat(300) },
    }),
  );
  addHistory(entry(2, { outcome: { type: "cancelled" } }));
  const result = (await list.run({ limit: 2 })) as {
    text: string;
    outcome: { text?: string };
  }[];
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].outcome, { type: "cancelled" });
  assert.equal(result[1].text, "a".repeat(200));
  assert.equal(result[1].outcome.text, "b".repeat(200));
});

test("listHistory fails with capability for a limit under 1", async () => {
  await assert.rejects(
    list.run({ limit: 0 }),
    (err: Error & { code?: string }) => {
      return err.code === undefined && /limit/.test(err.message);
    },
  );
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
