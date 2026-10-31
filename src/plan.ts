// The plan check: a plan runs only when it fits the site context
// (contract-plan.md, Steps, Include output, References, Failures, Limits).
// It is the same check as the server's (dicta-action-server/src/plan.ts).

import type { SiteContext } from "./context.ts";
import type { Schema } from "./module.ts";

const MAX_STEPS = 50;
const MAX_BYTES = 16 * 1024;
const MAX_LABEL_CHARS = 200;

export type CallStep = {
  call: string;
  args: Record<string, unknown>;
  includeOutput?: boolean;
};

export type ForEachStep = {
  forEach: string;
  do: CallStep[];
  includeOutput?: boolean;
};

export type Plan = {
  steps: (CallStep | ForEachStep)[];
  text?: string;
  final?: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: string[],
  path: string,
) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new Error(`${path} has ${key}, which is not allowed`);
    }
  }
}

// A string that starts with $ refers to an output; one that starts with $$ is
// a plain string (contract-plan.md, References).
export function isReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("$") &&
    !value.startsWith("$$")
  );
}

// What a reference may point to where it is used: the top-level steps before
// this one, and $item inside the do of a forEach.
type Scope = { earlierSteps: number; inForEach: boolean };

function checkReference(ref: string, scope: Scope, path: string) {
  const [head = "", ...rest] = ref.slice(1).split(".");
  if (rest.some((part) => part === "")) {
    throw new Error(`${path}: ${ref} has an empty path part`);
  }
  if (/^\d+$/.test(head)) {
    const step = Number(head);
    if (step < 1 || step > scope.earlierSteps) {
      throw new Error(`${path}: ${ref} does not point to an earlier step`);
    }
    return;
  }
  if (head !== "item") {
    throw new Error(`${path}: ${ref} is not a step number or $item`);
  }
  if (!scope.inForEach) {
    throw new Error(`${path}: ${ref} is used outside a forEach`);
  }
}

// Checks every reference in a value, at any depth.
function checkReferences(value: unknown, scope: Scope, path: string) {
  if (isReference(value)) {
    checkReference(value, scope, path);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => checkReferences(item, scope, `${path}[${i}]`));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      checkReferences(item, scope, `${path}.${key}`);
    }
  }
}

function hasType(value: unknown, type: string) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isObject(value);
    default:
      return false;
  }
}

// Checks a value against a capability's schema. Before the plan runs, a
// reference stands for any value, since its value is known only then; once
// references are filled in, every string is checked as it is.
function matches(
  value: unknown,
  schema: Schema,
  path: string,
  references: boolean,
) {
  if (references && isReference(value)) {
    return;
  }
  if (schema.type !== undefined && !hasType(value, schema.type)) {
    throw new Error(`${path} must be of type ${schema.type}`);
  }
  // Before references are filled in, a string written with $$ is compared as
  // the capability gets it, with a single $ (contract-plan.md, References).
  const literal =
    references && typeof value === "string" && value.startsWith("$$")
      ? value.slice(1)
      : value;
  if (
    schema.enum !== undefined &&
    !schema.enum.some(
      (option) => JSON.stringify(option) === JSON.stringify(literal),
    )
  ) {
    throw new Error(`${path} is not one of the allowed values`);
  }
  if (isObject(value)) {
    // Only own properties count, never inherited ones such as __proto__.
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) {
        throw new Error(`${path}.${name} is required`);
      }
    }
    // A property the schema does not name is refused, also when it names none
    // (contract-plan.md, Failures).
    const properties = schema.properties ?? {};
    for (const name of Object.keys(value)) {
      if (!Object.hasOwn(properties, name)) {
        throw new Error(`${path}.${name} is not in the schema`);
      }
    }
    for (const [name, property] of Object.entries(properties)) {
      if (Object.hasOwn(value, name)) {
        matches(value[name], property, `${path}.${name}`, references);
      }
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items;
    value.forEach((item, i) =>
      matches(item, items, `${path}[${i}]`, references),
    );
  }
}

// Checks a call's arguments against its capability's args schema: `{}` when it
// has none. With references, a reference stands for any value.
export function checkArgs(
  args: Record<string, unknown>,
  schema: Schema | undefined,
  path = "args",
  references = false,
) {
  if (schema === undefined) {
    if (Object.keys(args).length > 0) {
      throw new Error(`${path} must be {}`);
    }
    return;
  }
  matches(args, schema, path, references);
}

function checkIncludeOutput(step: Record<string, unknown>, path: string) {
  if (
    step.includeOutput !== undefined &&
    typeof step.includeOutput !== "boolean"
  ) {
    throw new Error(`${path}.includeOutput must be true or false`);
  }
}

function checkCall(
  step: Record<string, unknown>,
  context: SiteContext,
  scope: Scope,
  path: string,
) {
  // Only a top-level step may have includeOutput.
  onlyKeys(
    step,
    scope.inForEach ? ["call", "args"] : ["call", "args", "includeOutput"],
    path,
  );
  checkIncludeOutput(step, path);
  const capability = context.capabilities.find((c) => c.name === step.call);
  if (!capability) {
    throw new Error(`${path}.call names no capability: ${String(step.call)}`);
  }
  if (!isObject(step.args)) {
    throw new Error(`${path}.args must be an object`);
  }
  checkReferences(step.args, scope, `${path}.args`);
  checkArgs(step.args, capability.args, `${path}.args`, true);
}

// Checks a plan from the server. Throws an error with the reason.
export function checkPlan(
  plan: unknown,
  context: SiteContext,
): asserts plan is Plan {
  if (!isObject(plan)) {
    throw new Error("the plan must be an object");
  }
  if (new TextEncoder().encode(JSON.stringify(plan)).length > MAX_BYTES) {
    throw new Error("a plan is at most 16 KB");
  }
  onlyKeys(plan, ["steps", "text", "final"], "plan");
  if (plan.text !== undefined && typeof plan.text !== "string") {
    throw new Error("text must be a string");
  }
  // Characters are Unicode code points, as for every text (contract-plan.md,
  // Limits).
  if (
    typeof plan.text === "string" &&
    Array.from(plan.text).length > MAX_LABEL_CHARS
  ) {
    throw new Error(`text is longer than ${MAX_LABEL_CHARS} characters`);
  }
  if (plan.final !== undefined && typeof plan.final !== "boolean") {
    throw new Error("final must be true or false");
  }
  if (!Array.isArray(plan.steps)) {
    throw new Error("steps must be an array");
  }
  const steps: unknown[] = plan.steps;
  if (steps.length > MAX_STEPS) {
    throw new Error(`a plan has at most ${MAX_STEPS} steps`);
  }
  steps.forEach((step, i) => {
    const path = `steps[${i}]`;
    const scope: Scope = { earlierSteps: i, inForEach: false };
    if (!isObject(step)) {
      throw new Error(`${path} must be an object`);
    }
    if (Object.hasOwn(step, "call")) {
      checkCall(step, context, scope, path);
      return;
    }
    if (!Object.hasOwn(step, "forEach")) {
      throw new Error(`${path} must be a call or a forEach`);
    }
    onlyKeys(step, ["forEach", "do", "includeOutput"], path);
    checkIncludeOutput(step, path);
    if (!isReference(step.forEach) || !/^\$\d/.test(step.forEach)) {
      throw new Error(`${path}.forEach must refer to an earlier step`);
    }
    checkReference(step.forEach, scope, `${path}.forEach`);
    if (!Array.isArray(step.do)) {
      throw new Error(`${path}.do must be an array`);
    }
    const inner: Scope = { earlierSteps: i, inForEach: true };
    step.do.forEach((call: unknown, j) => {
      const innerPath = `${path}.do[${j}]`;
      if (!isObject(call) || !Object.hasOwn(call, "call")) {
        throw new Error(`${innerPath} must be a call`);
      }
      checkCall(call, context, inner, innerPath);
    });
  });
}
