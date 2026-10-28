import assert from "node:assert/strict";
import { test } from "node:test";

test("the entry module loads", async () => {
  const module = await import("../src/index.ts");
  assert.deepEqual(Object.keys(module), []);
});
