import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext } from "../src/context.ts";
import type { CapabilityModule } from "../src/index.ts";

const module: CapabilityModule = {
  site: { name: "Teamboard", desc: "A task list." },
  confirmOver: 5,
  state: {
    desc: "The open page.",
    run: async () => ({ page: "tasks" }),
  },
  capabilities: {
    "tasks.create": {
      level: "write",
      desc: "Creates a task.",
      confirm: async ({ title }) => `Create task "${String(title)}"`,
      args: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      output: { type: "object", properties: { id: { type: "string" } } },
      run: async () => ({ id: "t1" }),
    },
    "tasks.clear": {
      level: "destructive",
      desc: "Deletes all tasks.",
      run: async () => null,
    },
  },
};

test("the context holds the site, the state desc and each capability", () => {
  assert.deepEqual(buildContext(module), {
    site: { name: "Teamboard", desc: "A task list." },
    state: { desc: "The open page." },
    capabilities: [
      {
        name: "tasks.create",
        level: "write",
        desc: "Creates a task.",
        args: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
        output: { type: "object", properties: { id: { type: "string" } } },
      },
      { name: "tasks.clear", level: "destructive", desc: "Deletes all tasks." },
    ],
  });
});

test("a capability without args and output has neither key", () => {
  const entry = buildContext(module).capabilities[1];
  assert.equal(Object.hasOwn(entry, "args"), false);
  assert.equal(Object.hasOwn(entry, "output"), false);
});

test("functions and confirmOver are left out", () => {
  const json = JSON.stringify(buildContext(module));
  assert.deepEqual(JSON.parse(json), buildContext(module));
  assert.equal(json.includes("confirmOver"), false);
  for (const entry of buildContext(module).capabilities) {
    assert.equal(Object.hasOwn(entry, "run"), false);
    assert.equal(Object.hasOwn(entry, "confirm"), false);
  }
});

test("a capability may name its own argument type", () => {
  const typed: CapabilityModule = {
    ...module,
    capabilities: {
      "tasks.get": {
        level: "read",
        desc: "Returns a task.",
        run: async ({ id }: { id: string }) => ({ id }),
      },
    },
  };
  assert.equal(buildContext(typed).capabilities[0].name, "tasks.get");
});
