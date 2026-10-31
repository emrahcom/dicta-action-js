import assert from "node:assert/strict";
import { test } from "node:test";
import type { SiteContext } from "../src/context.ts";
import { checkArgs, checkPlan } from "../src/plan.ts";

const CONTEXT: SiteContext = {
  site: { name: "Teamboard", desc: "A task list." },
  state: { desc: "The open page." },
  capabilities: [
    {
      name: "tasks.list",
      level: "read",
      desc: "Lists the tasks.",
      args: { type: "object", properties: { q: { type: "string" } } },
    },
    {
      name: "tasks.count",
      level: "read",
      desc: "Counts the tasks.",
    },
    {
      name: "tasks.create",
      level: "write",
      desc: "Adds a task.",
      args: {
        type: "object",
        properties: {
          title: { type: "string" },
          priority: { type: "integer" },
          tags: { type: "array", items: { type: "string" } },
          color: { enum: ["red", "green"] },
        },
        required: ["title"],
      },
    },
    {
      name: "tasks.move",
      level: "write",
      desc: "Moves a task.",
      args: {
        type: "object",
        properties: {
          id: { type: "string" },
          to: { type: "object", properties: { project: { type: "string" } } },
          meta: { type: "object" },
        },
        required: ["id"],
      },
    },
    {
      name: "tasks.tag",
      level: "write",
      desc: "Tags a task.",
      args: {
        type: "object",
        properties: { constructor: { type: "string" } },
        required: ["constructor"],
      },
    },
    {
      name: "tasks.clear",
      level: "write",
      desc: "Clears the done tasks.",
      args: { type: "object" },
    },
  ],
};

const list = { call: "tasks.list", args: {} };
const create = (args: unknown) => ({ call: "tasks.create", args });
const move = (args: unknown) => ({ call: "tasks.move", args });

const VALID: [string, unknown][] = [
  ["an empty plan", { steps: [] }],
  ["a final plan", { steps: [list], final: true }],
  ["a plan with a label", { steps: [list], text: "Listing the tasks" }],
  [
    "a label of 200 characters",
    { steps: [list], text: "\u{1F600}".repeat(200) },
  ],
  [
    "a call with all argument types",
    {
      steps: [create({ title: "a", priority: 2, tags: ["x"], color: "red" })],
    },
  ],
  [
    "a reference to an earlier step",
    { steps: [list, create({ title: "$1.0.title" })] },
  ],
  [
    "a reference inside nested arguments",
    { steps: [list, create({ title: "a", tags: ["$1.0.id"] })] },
  ],
  [
    "a reference that stands for a number",
    { steps: [list, create({ title: "a", priority: "$1.length" })] },
  ],
  ["$$ as a plain string", { steps: [create({ title: "$$5 lunch" })] }],
  [
    "a required argument named like an inherited one",
    { steps: [{ call: "tasks.tag", args: { constructor: "x" } }] },
  ],
  [
    "empty objects for schemas that name no properties",
    {
      steps: [{ call: "tasks.clear", args: {} }, move({ id: "t1", meta: {} })],
    },
  ],
  [
    "empty args for a capability without args",
    { steps: [{ call: "tasks.count", args: {} }] },
  ],
  [
    "a forEach over an earlier step",
    {
      steps: [list, { forEach: "$1", do: [create({ title: "$item.title" })] }],
    },
  ],
  [
    "a forEach that uses an earlier step inside",
    {
      steps: [
        list,
        list,
        { forEach: "$2", do: [create({ title: "$1.0.title" })] },
      ],
    },
  ],
  [
    "nested arguments the schema names",
    { steps: [move({ id: "t1", to: { project: "p1" } })] },
  ],
  [
    "$item in nested arguments",
    {
      steps: [
        list,
        {
          forEach: "$1",
          do: [move({ id: "$item.id", to: { project: "$item.project" } })],
        },
      ],
    },
  ],
  [
    "includeOutput on calls",
    {
      steps: [
        { ...list, includeOutput: true },
        { ...list, includeOutput: false },
      ],
    },
  ],
  [
    "includeOutput on a forEach",
    { steps: [list, { forEach: "$1", do: [list], includeOutput: true }] },
  ],
  [
    "a plan of 16 KB",
    {
      steps: [
        create({
          title: "a".repeat(
            16 * 1024 -
              '{"steps":[{"call":"tasks.create","args":{"title":""}}]}'.length,
          ),
        }),
      ],
    },
  ],
  ["50 steps", { steps: Array(50).fill(list) }],
];

for (const [name, plan] of VALID) {
  test(`accepts ${name}`, () => {
    assert.doesNotThrow(() => checkPlan(plan, CONTEXT));
  });
}

const INVALID: [string, unknown, RegExp][] = [
  ["a plan that is not an object", [], /plan must be an object/],
  ["a plan without steps", {}, /steps must be an array/],
  ["an unknown plan field", { steps: [], next: "go" }, /plan has next/],
  [
    "arguments for a capability without args",
    { steps: [{ call: "tasks.count", args: { q: "a" } }] },
    /args must be \{\}/,
  ],
  [
    "a call without args",
    { steps: [{ call: "tasks.count" }] },
    /args must be an object/,
  ],
  ["final that is not a boolean", { steps: [], final: "yes" }, /final must be/],
  ["a label that is not text", { steps: [], text: 5 }, /text must be a string/],
  [
    "a label of 201 characters",
    { steps: [], text: "x".repeat(201) },
    /text is longer than 200 characters/,
  ],
  ["51 steps", { steps: Array(51).fill(list) }, /at most 50 steps/],
  [
    "a plan over 16 KB",
    { steps: [create({ title: "a".repeat(16 * 1024) })] },
    /at most 16 KB/,
  ],
  ["a step that is neither", { steps: [{ wait: 1 }] }, /a call or a forEach/],
  [
    "an unknown capability",
    { steps: [{ call: "tasks.fly", args: {} }] },
    /names no capability: tasks\.fly/,
  ],
  [
    "a call without args",
    { steps: [{ call: "tasks.list" }] },
    /args must be an object/,
  ],
  ["an unknown call field", { steps: [{ ...list, wait: 1 }] }, /has wait/],
  [
    "a missing required argument",
    { steps: [create({})] },
    /args\.title is required/,
  ],
  [
    "a missing required argument named like an inherited one",
    { steps: [{ call: "tasks.tag", args: {} }] },
    /args\.constructor is required/,
  ],
  [
    "an argument named __proto__",
    { steps: [create(JSON.parse('{"title":"a","__proto__":{"admin":true}}'))] },
    /args\.__proto__ is not in the schema/,
  ],
  [
    "an argument named toString",
    { steps: [create({ title: "a", toString: "x" })] },
    /args\.toString is not in the schema/,
  ],
  [
    "an argument the schema does not name",
    { steps: [create({ title: "a", owner: "chen" })] },
    /args\.owner is not in the schema/,
  ],
  [
    "a nested argument the schema does not name",
    { steps: [move({ id: "t1", to: { project: "p1", board: "b" } })] },
    /args\.to\.board is not in the schema/,
  ],
  [
    "an argument for a schema that names no properties",
    { steps: [{ call: "tasks.clear", args: { all: true } }] },
    /args\.all is not in the schema/,
  ],
  [
    "a nested argument for a schema that names no properties",
    { steps: [move({ id: "t1", meta: { color: "red" } })] },
    /args\.meta\.color is not in the schema/,
  ],
  [
    "an argument of the wrong type",
    { steps: [create({ title: 5 })] },
    /args\.title must be of type string/,
  ],
  [
    "an integer that is not whole",
    { steps: [create({ title: "a", priority: 1.5 })] },
    /priority must be of type integer/,
  ],
  [
    "a wrong array item",
    { steps: [create({ title: "a", tags: [1] })] },
    /tags\[0\] must be of type string/,
  ],
  [
    "a value outside the enum",
    { steps: [create({ title: "a", color: "blue" })] },
    /color is not one of/,
  ],
  [
    "a reference to the same step",
    { steps: [create({ title: "$1" })] },
    /\$1 does not point to an earlier step/,
  ],
  [
    "a reference to a later step",
    { steps: [list, create({ title: "$3" })] },
    /\$3 does not point/,
  ],
  [
    "a reference to step 0",
    { steps: [list, create({ title: "$0" })] },
    /\$0 does not point/,
  ],
  [
    "$item outside a forEach",
    { steps: [list, create({ title: "$item.title" })] },
    /\$item\.title is used outside a forEach/,
  ],
  [
    "a reference that is neither a step nor $item",
    { steps: [list, create({ title: "$task.title" })] },
    /\$task\.title is not a step number or \$item/,
  ],
  [
    "a reference with an empty path part",
    { steps: [list, create({ title: "$1..id" })] },
    /empty path part/,
  ],
  [
    "a forEach over a later step",
    { steps: [{ forEach: "$1", do: [list] }] },
    /\$1 does not point/,
  ],
  [
    "a forEach over an item name",
    { steps: [list, { forEach: "$item", do: [list] }] },
    /forEach must refer to an earlier step/,
  ],
  [
    "a forEach with as",
    { steps: [list, { forEach: "$1", as: "t", do: [list] }] },
    /has as/,
  ],
  [
    "includeOutput that is not a boolean",
    { steps: [{ ...list, includeOutput: "yes" }] },
    /includeOutput must be true or false/,
  ],
  [
    "includeOutput on a call in a do",
    {
      steps: [list, { forEach: "$1", do: [{ ...list, includeOutput: true }] }],
    },
    /do\[0\] has includeOutput/,
  ],
  [
    "a forEach inside a forEach",
    {
      steps: [list, { forEach: "$1", do: [{ forEach: "$1", do: [list] }] }],
    },
    /do\[0\] must be a call/,
  ],
];

for (const [name, plan, message] of INVALID) {
  test(`refuses ${name}`, () => {
    assert.throws(() => checkPlan(plan, CONTEXT), { message });
  });
}

const createArgs = CONTEXT.capabilities.find(
  (c) => c.name === "tasks.create",
)?.args;

test("filled-in arguments are checked as they are", () => {
  assert.doesNotThrow(() => checkArgs({ title: "$5 lunch" }, createArgs));
  assert.throws(
    () => checkArgs({ title: "a", priority: "$1" }, createArgs),
    /args\.priority must be of type integer/,
  );
});

test("filled-in arguments have no inherited names", () => {
  assert.throws(
    () => checkArgs({ title: "a", toString: "x" }, createArgs),
    /args\.toString is not in the schema/,
  );
  assert.throws(() => checkArgs({}, createArgs), /args\.title is required/);
});

test("filled-in arguments are {} for a capability without args", () => {
  assert.doesNotThrow(() => checkArgs({}, undefined));
  assert.throws(() => checkArgs({ q: "a" }, undefined), /args must be \{\}/);
});
