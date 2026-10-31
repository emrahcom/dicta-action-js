import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapabilityModule } from "../src/index.ts";
import type { Plan } from "../src/plan.ts";
import { runPlan } from "../src/run.ts";

type Args = Record<string, unknown>;

// A module whose capabilities record their calls.
function moduleWith(capabilities: CapabilityModule["capabilities"]) {
  const module: CapabilityModule = {
    site: { name: "Teamboard", desc: "A task list." },
    state: { desc: "The open page.", run: async () => ({}) },
    capabilities,
  };
  return module;
}

const calls: [string, Args][] = [];

function recorder(name: string, output: (args: Args) => unknown) {
  return async (args: Args) => {
    calls.push([name, args]);
    return output(args);
  };
}

const TASKS = [
  { id: "t1", title: "Budget" },
  { id: "t2", title: "Review" },
];

const module = moduleWith({
  "tasks.list": {
    level: "read",
    desc: "Lists tasks.",
    output: { type: "array" },
    run: recorder("tasks.list", () => TASKS),
  },
  "tasks.update": {
    level: "write",
    desc: "Updates a task.",
    args: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" } },
      required: ["id"],
    },
    run: recorder("tasks.update", (args) => ({ id: args.id })),
  },
  "tasks.count": {
    level: "read",
    desc: "Counts.",
    args: { type: "object", properties: { n: { type: "integer" } } },
    run: recorder("tasks.count", (args) => args.n),
  },
  "tasks.fail": {
    level: "write",
    desc: "Fails.",
    args: { type: "object", properties: { id: { type: "string" } } },
    run: async (args) => {
      calls.push(["tasks.fail", args]);
      if (args.id === "t2") {
        throw Object.assign(new Error("No such task"), { code: "not_found" });
      }
      return { id: args.id };
    },
  },
  "tasks.throw": {
    level: "write",
    desc: "Throws.",
    run: async () => {
      throw new Error("x".repeat(300));
    },
  },
  "tasks.big": {
    level: "read",
    desc: "Returns a large output.",
    args: { type: "object", properties: { size: { type: "integer" } } },
    run: async (args) => "a".repeat(args.size as number),
  },
});

async function run(plan: Plan) {
  calls.length = 0;
  return runPlan(plan, module);
}

const list = { call: "tasks.list", args: {} };

test("runs the steps in order and reports included outputs", async () => {
  const report = await run({
    steps: [
      { ...list, includeOutput: true },
      { call: "tasks.update", args: { id: "t1" } },
    ],
  });
  assert.deepEqual(report, { outputs: { 1: TASKS } });
  assert.deepEqual(
    calls.map(([name]) => name),
    ["tasks.list", "tasks.update"],
  );
});

test("an empty report when nothing is included and nothing halts", async () => {
  assert.deepEqual(await run({ steps: [list] }), {});
});

test("references are filled in with their JSON type", async () => {
  await run({
    steps: [
      list,
      { call: "tasks.update", args: { id: "$1.0.id", title: "$1.1.title" } },
      { call: "tasks.count", args: { n: "$1.length" } },
    ],
  });
  assert.deepEqual(calls[1], ["tasks.update", { id: "t1", title: "Review" }]);
  assert.deepEqual(calls[2], ["tasks.count", { n: 2 }]);
});

test("$$ is passed on with a single $", async () => {
  await run({ steps: [{ call: "tasks.update", args: { id: "$$5" } }] });
  assert.deepEqual(calls[0], ["tasks.update", { id: "$5" }]);
});

test("a filled-in value is checked again", async () => {
  const report = await run({
    steps: [list, { call: "tasks.count", args: { n: "$1.0.id" } }],
  });
  assert.equal(report.halt?.code, "reference");
  assert.equal(report.halt?.step, 2);
  assert.match(report.halt?.message ?? "", /n must be of type integer/);
});

test("a reference without a value halts", async () => {
  const report = await run({
    steps: [list, { call: "tasks.update", args: { id: "$1.5.id" } }],
  });
  assert.deepEqual(report.halt, {
    step: 2,
    code: "reference",
    message: "$1.5.id has no value",
  });
});

test("a reference never reaches inherited names", async () => {
  const report = await run({
    steps: [list, { call: "tasks.update", args: { id: "$1.0.constructor" } }],
  });
  assert.equal(report.halt?.code, "reference");
});

test("a forEach runs its calls for each item", async () => {
  const report = await run({
    steps: [
      list,
      {
        forEach: "$1",
        do: [{ call: "tasks.update", args: { id: "$item.id" } }],
        includeOutput: true,
      },
    ],
  });
  assert.deepEqual(report, {
    outputs: { 2: [[{ id: "t1" }], [{ id: "t2" }]] },
  });
});

test("a forEach over a value that is not an array halts", async () => {
  const report = await run({
    steps: [
      list,
      { forEach: "$1.0", do: [{ call: "tasks.update", args: { id: "x" } }] },
    ],
  });
  assert.deepEqual(report.halt, {
    step: 2,
    code: "reference",
    message: "$1.0 is not an array",
  });
});

test("a forEach over more than 100 items halts before any item", async () => {
  const many = moduleWith({
    ...module.capabilities,
    "tasks.list": {
      level: "read",
      desc: "Lists.",
      run: async () => Array(101).fill({ id: "t" }),
    },
  });
  calls.length = 0;
  const report = await runPlan(
    {
      steps: [
        list,
        { forEach: "$1", do: [{ call: "tasks.update", args: { id: "x" } }] },
      ],
    },
    many,
  );
  assert.equal(report.halt?.code, "limit");
  assert.equal(report.halt?.step, 2);
  assert.equal(report.halt?.item, undefined);
  assert.equal(calls.length, 0);
});

test("a halt in a forEach has its item, call and the outputs so far", async () => {
  const report = await run({
    steps: [
      list,
      {
        forEach: "$1",
        do: [
          { call: "tasks.update", args: { id: "$item.id" } },
          { call: "tasks.fail", args: { id: "$item.id" } },
        ],
        includeOutput: true,
      },
      list,
    ],
  });
  assert.deepEqual(report, {
    halt: {
      step: 2,
      code: "not_found",
      message: "No such task",
      item: 1,
      do: 1,
      outputs: [[{ id: "t1" }, { id: "t1" }], [{ id: "t2" }]],
    },
  });
  // Nothing after the failed call ran.
  assert.equal(calls.length, 5);
});

test("a halt in a forEach without includeOutput has no outputs", async () => {
  const report = await run({
    steps: [
      list,
      { forEach: "$1", do: [{ call: "tasks.fail", args: { id: "$item.id" } }] },
    ],
  });
  assert.equal(report.halt?.item, 1);
  assert.equal(report.halt?.do, 0);
  assert.equal(Object.hasOwn(report.halt ?? {}, "outputs"), false);
});

test("a capability error without a code is capability, cut to 200", async () => {
  const report = await run({
    steps: [
      { ...list, includeOutput: true },
      { call: "tasks.throw", args: {} },
      { ...list, includeOutput: true },
    ],
  });
  assert.deepEqual(report.outputs, { 1: TASKS });
  assert.equal(report.halt?.step, 2);
  assert.equal(report.halt?.code, "capability");
  assert.equal(report.halt?.message, "x".repeat(200));
});

test("outputs over 16 KB together are left out with their size", async () => {
  const half = 9000;
  const report = await run({
    steps: [
      { call: "tasks.big", args: { size: half }, includeOutput: true },
      { call: "tasks.big", args: { size: half }, includeOutput: true },
      { call: "tasks.big", args: { size: 10 }, includeOutput: true },
    ],
  });
  assert.deepEqual(Object.keys(report.outputs ?? {}), ["1", "3"]);
  assert.deepEqual(report.tooLarge, { 2: half + 2 });
});

test("halt outputs that do not fit go into halt.tooLarge", async () => {
  const report = await run({
    steps: [
      { call: "tasks.big", args: { size: 16 * 1024 - 2 }, includeOutput: true },
      list,
      {
        forEach: "$2",
        do: [{ call: "tasks.fail", args: { id: "$item.id" } }],
        includeOutput: true,
      },
    ],
  });
  assert.deepEqual(Object.keys(report.outputs ?? {}), ["1"]);
  assert.equal(report.halt?.code, "not_found");
  assert.equal(Object.hasOwn(report.halt ?? {}, "outputs"), false);
  assert.equal(report.halt?.tooLarge, bytes([[{ id: "t1" }], []]));
});

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
