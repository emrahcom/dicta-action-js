import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapabilityModule } from "../src/index.ts";
import { buildContext } from "../src/context.ts";
import { checkPlan, type Plan } from "../src/plan.ts";
import {
  type Confirmation,
  newProgress,
  reportSoFar,
  runPlan,
  type Stop,
} from "../src/run.ts";

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
  "tasks.invalid": {
    level: "write",
    desc: "Throws with a client code.",
    run: async () => {
      throw Object.assign(new Error("Bad input"), { code: "invalid" });
    },
  },
  "tasks.big": {
    level: "read",
    desc: "Returns a large output.",
    args: { type: "object", properties: { size: { type: "integer" } } },
    run: async (args) => "a".repeat(args.size as number),
  },
});

// Every confirmation asked, answered with `answer`.
const asked: Confirmation[] = [];
let answer = true;

async function ask(confirmation: Confirmation) {
  asked.push(confirmation);
  return answer;
}

async function run(plan: Plan, using = module) {
  calls.length = 0;
  asked.length = 0;
  return runPlan(
    plan,
    using,
    ask,
    () => undefined,
    newProgress(),
    () => false,
  );
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

test("a $$ string passes an enum of its single-$ value", async () => {
  const using = moduleWith({
    "prices.set": {
      level: "read",
      desc: "Sets the currency.",
      args: {
        type: "object",
        properties: { currency: { enum: ["$USD"] } },
      },
      run: recorder("prices.set", () => null),
    },
  });
  const plan = {
    steps: [{ call: "prices.set", args: { currency: "$$USD" } }],
  };
  checkPlan(plan, buildContext(using));
  const report = await run(plan, using);
  assert.deepEqual(report, {});
  assert.deepEqual(calls[0], ["prices.set", { currency: "$USD" }]);
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
  const report = await run(
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

test("a capability code that is a client code is reported as capability", async () => {
  const report = await run({ steps: [{ call: "tasks.invalid", args: {} }] });
  assert.deepEqual(report.halt, {
    step: 1,
    code: "capability",
    message: "Bad input",
  });
});

test("a step that asks without confirm fails and nothing runs", async () => {
  const report = await run(
    { steps: [list, { call: "tasks.remove", args: {} }] },
    moduleWith({
      ...module.capabilities,
      "tasks.remove": {
        level: "destructive",
        desc: "Removes all tasks.",
        run: recorder("tasks.remove", () => null),
      },
    }),
  );
  assert.deepEqual(report.halt, {
    step: 2,
    code: "capability",
    message: "the capability has no confirm",
  });
  assert.deepEqual(asked, []);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["tasks.list"],
  );
});

// A module whose capabilities return values that are not plain JSON.
const odd = moduleWith({
  ...module.capabilities,
  "tasks.none": {
    level: "read",
    desc: "Returns nothing.",
    run: async () => undefined,
  },
  "tasks.date": {
    level: "read",
    desc: "Returns a date.",
    run: async () => ({ at: new Date(0) }),
  },
  "tasks.cycle": {
    level: "read",
    desc: "Returns a cyclic object.",
    args: { type: "object", properties: { id: { type: "string" } } },
    run: async () => {
      const task: Record<string, unknown> = { id: "t1" };
      task.self = task;
      return task;
    },
  },
});

test("outputs are turned into JSON for references and the report", async () => {
  const report = await run(
    {
      steps: [
        { call: "tasks.none", args: {}, includeOutput: true },
        { call: "tasks.date", args: {}, includeOutput: true },
        { call: "tasks.update", args: { id: "$2.at" } },
      ],
    },
    odd,
  );
  const at = new Date(0).toJSON();
  assert.deepEqual(report, { outputs: { 1: null, 2: { at } } });
  assert.deepEqual(calls, [["tasks.update", { id: at }]]);
});

test("an output that is not JSON fails its step with capability", async () => {
  const halt = { code: "capability", message: "the output is not JSON" };
  const step = await run({ steps: [{ call: "tasks.cycle", args: {} }] }, odd);
  assert.deepEqual(step.halt, { step: 1, ...halt });
  const forEach = await run(
    {
      steps: [
        list,
        {
          forEach: "$1",
          do: [{ call: "tasks.cycle", args: { id: "$item.id" } }],
        },
      ],
    },
    odd,
  );
  assert.deepEqual(forEach.halt, { step: 2, ...halt, item: 0, do: 0 });
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

// Confirmations (contract-plan.md, Confirmation).

function confirmModule(items: number) {
  return moduleWith({
    "tasks.list": {
      level: "read",
      desc: "Lists.",
      run: async () =>
        Array.from({ length: items }, (_, i) => ({ id: `t${i + 1}` })),
    },
    "tasks.delete": {
      level: "destructive",
      desc: "Deletes a task.",
      args: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      confirm: async (args) => `Delete ${String(args.id)}`,
      run: recorder("tasks.delete", (args) => ({ id: args.id })),
    },
    "tasks.update": {
      level: "write",
      desc: "Updates a task.",
      args: { type: "object", properties: { id: { type: "string" } } },
      confirm: async (args) => `Update ${String(args.id)}`,
      run: recorder("tasks.update", (args) => ({ id: args.id })),
    },
    "tasks.share": {
      level: "external",
      desc: "Shares a task.",
      args: { type: "object", properties: { id: { type: "string" } } },
      confirm: async () => {
        throw Object.assign(new Error("Unknown user"), { code: "not_found" });
      },
      run: recorder("tasks.share", () => null),
    },
    "tasks.send": {
      level: "external",
      desc: "Sends a task, without confirm.",
      run: recorder("tasks.send", () => null),
    },
  });
}

function withConfirmOver(using: CapabilityModule, confirmOver: number) {
  return { ...using, confirmOver };
}

test("a destructive call asks with its confirm text", async () => {
  answer = true;
  const report = await run(
    { steps: [{ call: "tasks.delete", args: { id: "t1" } }] },
    confirmModule(0),
  );
  assert.deepEqual(asked, [{ items: [["Delete t1"]] }]);
  assert.deepEqual(report, {});
  assert.deepEqual(calls, [["tasks.delete", { id: "t1" }]]);
});

test("a read or write call does not ask", async () => {
  await run(
    {
      steps: [
        { call: "tasks.list", args: {} },
        { call: "tasks.update", args: { id: "t1" } },
      ],
    },
    confirmModule(1),
  );
  assert.deepEqual(asked, []);
});

test("Cancel halts with cancelled and runs nothing more", async () => {
  answer = false;
  const report = await run(
    {
      steps: [
        { call: "tasks.update", args: { id: "t1" } },
        { call: "tasks.delete", args: { id: "t1" } },
        { call: "tasks.update", args: { id: "t2" } },
      ],
    },
    confirmModule(0),
  );
  answer = true;
  assert.deepEqual(report.halt, {
    step: 2,
    code: "cancelled",
    message: "Cancelled",
  });
  assert.deepEqual(calls, [["tasks.update", { id: "t1" }]]);
});

test("a confirm that throws fails the step before it runs", async () => {
  const report = await run(
    { steps: [{ call: "tasks.share", args: { id: "t1" } }] },
    confirmModule(0),
  );
  assert.deepEqual(report.halt, {
    step: 1,
    code: "not_found",
    message: "Unknown user",
  });
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});

test("a missing confirm fails the step as a capability error", async () => {
  const report = await run(
    { steps: [{ call: "tasks.send", args: {} }] },
    confirmModule(0),
  );
  assert.equal(report.halt?.code, "capability");
  assert.deepEqual(calls, []);
});

const deleteEach = {
  forEach: "$1",
  do: [{ call: "tasks.delete", args: { id: "$item.id" } }],
};

test("a destructive forEach asks once with the first three items", async () => {
  await run(
    { steps: [{ call: "tasks.list", args: {} }, deleteEach] },
    confirmModule(5),
  );
  assert.deepEqual(asked, [
    { items: [["Delete t1"], ["Delete t2"], ["Delete t3"]], count: 5 },
  ]);
  assert.equal(calls.length, 5);
});

test("a forEach of three items or fewer has no count", async () => {
  await run(
    { steps: [{ call: "tasks.list", args: {} }, deleteEach] },
    confirmModule(3),
  );
  assert.deepEqual(asked, [
    { items: [["Delete t1"], ["Delete t2"], ["Delete t3"]] },
  ]);
});

test("a forEach of no items does not ask", async () => {
  await run(
    { steps: [{ call: "tasks.list", args: {} }, deleteEach] },
    confirmModule(0),
  );
  assert.deepEqual(asked, []);
});

const updateEach = {
  forEach: "$1",
  do: [{ call: "tasks.update", args: { id: "$item.id" } }],
};

test("a write forEach asks only over confirmOver, 10 by default", async () => {
  const steps = [{ call: "tasks.list", args: {} }, updateEach];
  await run({ steps }, confirmModule(10));
  assert.deepEqual(asked, []);
  await run({ steps }, confirmModule(11));
  assert.equal(asked.length, 1);
  await run({ steps }, withConfirmOver(confirmModule(3), 2));
  assert.deepEqual(asked, [
    { items: [["Update t1"], ["Update t2"], ["Update t3"]] },
  ]);
});

test("an item shows the texts of all its calls that ask", async () => {
  await run(
    {
      steps: [
        { call: "tasks.list", args: {} },
        {
          forEach: "$1",
          do: [
            { call: "tasks.update", args: { id: "$item.id" } },
            { call: "tasks.delete", args: { id: "$item.id" } },
          ],
        },
      ],
    },
    withConfirmOver(confirmModule(2), 1),
  );
  assert.deepEqual(asked, [
    {
      items: [
        ["Update t1", "Delete t1"],
        ["Update t2", "Delete t2"],
      ],
    },
  ]);
});

test("a bad item halts the forEach before the user is asked", async () => {
  const report = await run(
    {
      steps: [
        { call: "tasks.list", args: {} },
        {
          forEach: "$1",
          do: [{ call: "tasks.delete", args: { id: "$item.title" } }],
        },
      ],
    },
    confirmModule(2),
  );
  assert.equal(report.halt?.code, "reference");
  assert.equal(report.halt?.step, 2);
  assert.equal(report.halt?.item, undefined);
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});

test("the halt before asking names the bad item in its message", async () => {
  const report = await run(
    { steps: [{ call: "tasks.list", args: {} }, deleteEach] },
    moduleWith({
      ...confirmModule(0).capabilities,
      "tasks.list": {
        level: "read",
        desc: "Lists.",
        run: async () => [{ id: "t1" }, { id: 2 }],
      },
    }),
  );
  assert.equal(report.halt?.code, "reference");
  assert.equal(report.halt?.item, undefined);
  assert.match(report.halt?.message ?? "", /^item 1: /);
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});

// Added text and cancel (contract-protocol.md, Added text and cancel).

// A stop that answers `value` from the given call on, counting from 1.
function stopAt(call: number, value: Stop) {
  let count = 0;
  return () => {
    count += 1;
    return count >= call ? value : undefined;
  };
}

test("a stop before a step halts there", async () => {
  calls.length = 0;
  const report = await runPlan(
    { steps: [list, list, list] },
    module,
    ask,
    stopAt(2, "interrupted"),
    newProgress(),
    () => false,
  );
  assert.deepEqual(report.halt, {
    step: 2,
    code: "interrupted",
    message: "The user added text",
  });
  assert.equal(calls.length, 1);
});

test("a stop in a forEach halts at the next item, without do", async () => {
  calls.length = 0;
  // Asked before steps 1 and 2, then before item 1 of step 2.
  const report = await runPlan(
    {
      steps: [
        list,
        {
          forEach: "$1",
          do: [
            { call: "tasks.update", args: { id: "$item.id" } },
            { call: "tasks.update", args: { id: "$item.id" } },
          ],
          includeOutput: true,
        },
      ],
    },
    module,
    ask,
    stopAt(3, "cancelled"),
    newProgress(),
    () => false,
  );
  assert.deepEqual(report.halt, {
    step: 2,
    code: "cancelled",
    message: "Cancelled",
    item: 1,
    outputs: [[{ id: "t1" }, { id: "t1" }]],
  });
  // The first item finished both its calls; nothing after it ran.
  assert.equal(calls.length, 3);
});

test("a forEach stopped between items without includeOutput", async () => {
  calls.length = 0;
  const report = await runPlan(
    {
      steps: [
        list,
        {
          forEach: "$1",
          do: [{ call: "tasks.update", args: { id: "$item.id" } }],
        },
      ],
    },
    module,
    ask,
    stopAt(3, "interrupted"),
    newProgress(),
    () => false,
  );
  assert.equal(report.halt?.item, 1);
  assert.equal(Object.hasOwn(report.halt ?? {}, "outputs"), false);
});

test("a stop after the last step does not halt", async () => {
  calls.length = 0;
  const report = await runPlan(
    { steps: [list] },
    module,
    ask,
    stopAt(2, "interrupted"),
    newProgress(),
    () => false,
  );
  assert.deepEqual(report, {});
});

// Page changes: the report so far (contract-protocol.md, Page changes).

test("the report so far halts at the running step with its outputs", async () => {
  const progress = newProgress();
  let soFar: unknown;
  let running: boolean | undefined;
  const leaving = moduleWith({
    ...module.capabilities,
    "page.open": {
      level: "write",
      desc: "Opens a page.",
      run: async () => {
        running = progress.running;
        soFar = reportSoFar(progress, "navigated", "The page changed");
        return null;
      },
    },
  });
  await runPlan(
    {
      steps: [
        { ...list, includeOutput: true },
        { call: "page.open", args: {} },
      ],
    },
    leaving,
    ask,
    () => undefined,
    progress,
    () => false,
  );
  assert.equal(running, true);
  assert.equal(progress.running, false);
  assert.deepEqual(soFar, {
    outputs: { 1: TASKS },
    halt: { step: 2, code: "navigated", message: "The page changed" },
  });
});

test("the report so far in a forEach has its item, call and outputs", async () => {
  const progress = newProgress();
  let soFar: unknown;
  const leaving = moduleWith({
    ...module.capabilities,
    "page.open": {
      level: "write",
      desc: "Opens a page.",
      args: { type: "object", properties: { id: { type: "string" } } },
      run: async (args) => {
        if (args.id === "t2") {
          soFar = reportSoFar(progress, "navigated", "The page changed");
        }
        return { id: args.id };
      },
    },
  });
  await runPlan(
    {
      steps: [
        list,
        {
          forEach: "$1",
          do: [
            { call: "tasks.update", args: { id: "$item.id" } },
            { call: "page.open", args: { id: "$item.id" } },
          ],
          includeOutput: true,
        },
      ],
    },
    leaving,
    ask,
    () => undefined,
    progress,
    () => false,
  );
  assert.deepEqual(soFar, {
    halt: {
      step: 2,
      code: "navigated",
      message: "The page changed",
      item: 1,
      do: 1,
      outputs: [[{ id: "t1" }, { id: "t1" }], [{ id: "t2" }]],
    },
  });
});

// A page load during a step (contract-protocol.md, Page changes).

// Runs a plan whose page.open starts a page load when its id is `at`. The
// steps after which the page load check ran are in `checked`.
const checked: (number | string)[] = [];
async function runWithPageLoad(plan: Plan, at = "t1") {
  calls.length = 0;
  checked.length = 0;
  let loading = false;
  const progress = newProgress();
  const loads = moduleWith({
    ...module.capabilities,
    "page.open": {
      level: "write",
      desc: "Opens a page.",
      pageLoad: true,
      args: { type: "object", properties: { id: { type: "string" } } },
      run: async (args) => {
        calls.push(["page.open", args]);
        loading ||= args.id === at;
        return { id: args.id };
      },
    },
  });
  return runPlan(
    plan,
    loads,
    ask,
    () => undefined,
    progress,
    () => {
      const { step, item, do: call } = progress;
      checked.push(item === undefined ? step : `${step}.${item}.${call}`);
      return loading;
    },
  );
}

const navigated = { code: "navigated", message: "The page changed" };
const open = { call: "page.open", args: { id: "t1" } };

test("a page load halts at the next step with the outputs so far", async () => {
  const report = await runWithPageLoad({
    steps: [
      { ...list, includeOutput: true },
      { ...open, includeOutput: true },
      list,
    ],
  });
  assert.deepEqual(report, {
    outputs: { 1: TASKS, 2: { id: "t1" } },
    halt: { step: 3, ...navigated },
  });
  assert.equal(calls.length, 2);
});

test("a page load in the last step has no halt", async () => {
  const report = await runWithPageLoad({ steps: [list, open] });
  assert.deepEqual(report, {});
});

test("a page load in a forEach halts at the next call", async () => {
  const report = await runWithPageLoad({
    steps: [
      list,
      {
        forEach: "$1",
        do: [
          { call: "page.open", args: { id: "$item.id" } },
          { call: "tasks.update", args: { id: "$item.id" } },
        ],
        includeOutput: true,
      },
    ],
  });
  assert.deepEqual(report.halt, {
    step: 2,
    ...navigated,
    item: 0,
    do: 1,
    outputs: [[{ id: "t1" }]],
  });
  assert.equal(calls.length, 2);
});

test("a page load at the end of an item halts at the next item", async () => {
  const report = await runWithPageLoad({
    steps: [
      list,
      {
        forEach: "$1",
        do: [{ call: "page.open", args: { id: "$item.id" } }],
        includeOutput: true,
      },
    ],
  });
  assert.deepEqual(report.halt, {
    step: 2,
    ...navigated,
    item: 1,
    do: 0,
    outputs: [[{ id: "t1" }], []],
  });
});

test("a page load at the end of a forEach halts at the next step", async () => {
  const report = await runWithPageLoad(
    {
      steps: [
        list,
        {
          forEach: "$1",
          do: [{ call: "page.open", args: { id: "$item.id" } }],
        },
        list,
      ],
    },
    "t2",
  );
  assert.deepEqual(report.halt, { step: 3, ...navigated });
  assert.equal(calls.length, 3);
});

test("a page load is looked for only after a call that may load one", async () => {
  const report = await runWithPageLoad(
    {
      steps: [
        list,
        { call: "page.open", args: { id: "t1" } },
        {
          forEach: "$1",
          do: [
            { call: "page.open", args: { id: "$item.id" } },
            { call: "tasks.update", args: { id: "$item.id" } },
          ],
        },
        {
          forEach: "$1",
          do: [
            { call: "tasks.update", args: { id: "$item.id" } },
            { call: "page.open", args: { id: "$item.id" } },
          ],
        },
        list,
      ],
    },
    "none",
  );
  assert.deepEqual(report, {});
  // After each call of page.open and no other.
  assert.deepEqual(checked, [2, "3.0.0", "3.1.0", "4.0.1", "4.1.1"]);
});

// Many top-level steps of one write capability (contract-plan.md,
// Confirmation).

function updates(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    call: "tasks.update",
    args: { id: `t${i + 1}` },
  }));
}

test("more write steps than confirmOver ask once with the first", async () => {
  answer = true;
  const report = await run(
    { steps: updates(3) },
    withConfirmOver(confirmModule(1), 2),
  );
  assert.deepEqual(asked, [{ items: [["Update t1"]], count: 3 }]);
  assert.deepEqual(report, {});
  assert.equal(calls.length, 3);
});

test("write steps up to confirmOver, 10 by default, do not ask", async () => {
  await run({ steps: updates(10) }, confirmModule(1));
  assert.deepEqual(asked, []);
  await run({ steps: updates(11) }, confirmModule(1));
  assert.deepEqual(asked, [{ items: [["Update t1"]], count: 11 }]);
});

test("write steps are counted per capability", async () => {
  const using = withConfirmOver(
    moduleWith({
      ...confirmModule(1).capabilities,
      "tasks.rename": {
        level: "write",
        desc: "Renames a task.",
        args: { type: "object", properties: { id: { type: "string" } } },
        confirm: async (args) => `Rename ${String(args.id)}`,
        run: recorder("tasks.rename", (args) => ({ id: args.id })),
      },
    }),
    2,
  );
  await run(
    {
      steps: [
        ...updates(2),
        { call: "tasks.rename", args: { id: "t1" } },
        { call: "tasks.rename", args: { id: "t2" } },
      ],
    },
    using,
  );
  assert.deepEqual(asked, []);
});

test("forEach calls are not counted with write steps", async () => {
  await run(
    { steps: [{ call: "tasks.list", args: {} }, updateEach, ...updates(2)] },
    withConfirmOver(confirmModule(2), 2),
  );
  assert.deepEqual(asked, []);
});

test("Cancel at many write steps halts at the first", async () => {
  answer = false;
  const report = await run(
    { steps: [{ call: "tasks.list", args: {} }, ...updates(3)] },
    withConfirmOver(confirmModule(1), 2),
  );
  answer = true;
  assert.deepEqual(report.halt, {
    step: 2,
    code: "cancelled",
    message: "Cancelled",
  });
  // No update ran; this module's tasks.list is not recorded.
  assert.equal(calls.length, 0);
});
