import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { dictaCapabilities } from "../src/builtins.ts";
import { addHistory, type HistoryEntry, readHistory } from "../src/history.ts";
import { entry, FakeStorage } from "./storage.ts";

beforeEach(() => {
  Object.assign(globalThis, { sessionStorage: new FakeStorage() });
});

const get = dictaCapabilities["dicta.getHistory"];

test("the only built-in is dicta.getHistory, a read capability with schemas", () => {
  assert.deepEqual(Object.keys(dictaCapabilities), ["dicta.getHistory"]);
  assert.equal(get.level, "read");
  assert.match(get.desc, /requestId of its history entry/);
  assert.equal(get.args?.type, "object");
  assert.notEqual(get.output, undefined);
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

test("a stored request lists every output over 512 bytes in tooLarge", async () => {
  const big = "a".repeat(600);
  addHistory(
    entry(1, {
      exchange: [
        {
          plan: { steps: [] },
          report: {
            outputs: { 1: big, 2: big, 5: { id: "t9" } },
            tooLarge: { 3: 5 },
            halt: { step: 4, code: "x", message: "m", outputs: [[big]] },
          },
        },
        { question: "Which?", answer: "This" },
      ],
    }),
  );
  const result = (await get.run({ requestId: "r1" })) as HistoryEntry;
  // Storage holds only what getHistory returns.
  assert.deepEqual(readHistory()[0], result);
  assert.deepEqual(result.exchange, [
    {
      plan: { steps: [] },
      report: {
        outputs: { 5: { id: "t9" } },
        tooLarge: { 1: 602, 2: 602, 3: 5 },
        halt: { step: 4, code: "x", message: "m", tooLarge: 606 },
      },
    },
    { question: "Which?", answer: "This" },
  ]);
});

test("a stored request over 16 KB keeps its small outputs", async () => {
  // 40 plans of about 500 bytes each, each with a small output.
  const exchange = Array.from({ length: 40 }, (_, i) => ({
    plan: { steps: [], text: "x".repeat(480) },
    report: { outputs: { 1: { id: `t${i}` } } },
  }));
  addHistory(entry(1, { exchange }));
  const result = (await get.run({ requestId: "r1" })) as HistoryEntry;
  assert.deepEqual(result.exchange, exchange);
});
