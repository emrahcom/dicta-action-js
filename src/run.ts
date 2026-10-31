// The plan runner: it runs a checked plan with the module's capabilities and
// builds the report (contract-plan.md, Steps, Include output, References,
// Failures, Limits; contract-protocol.md, Report).

import type { CapabilityModule } from "./module.ts";
import {
  type CallStep,
  checkArgs,
  type ForEachStep,
  isReference,
  type Plan,
} from "./plan.ts";

const MAX_ITEMS = 100;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_MESSAGE_CHARS = 200;

export type Halt = {
  step?: number;
  code: string;
  message: string;
  item?: number;
  do?: number;
  outputs?: unknown[][];
  tooLarge?: number;
};

export type Report = {
  outputs?: Record<string, unknown>;
  tooLarge?: Record<string, number>;
  halt?: Halt;
};

// A failure that halts the plan, with its code (contract-protocol.md, Report).
class Failure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function isCall(step: CallStep | ForEachStep): step is CallStep {
  return Object.hasOwn(step, "call");
}

function isContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Cuts a message to 200 characters (Unicode code points).
export function cut(message: string) {
  const chars = Array.from(message);
  return chars.length > MAX_MESSAGE_CHARS
    ? chars.slice(0, MAX_MESSAGE_CHARS).join("")
    : message;
}

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value) ?? "null").length;
}

// The outputs a reference can use: those of the earlier steps, and the item
// inside the do of a forEach.
type Scope = { outputs: unknown[]; item?: unknown };

function resolve(ref: string, scope: Scope): unknown {
  const [head = "", ...path] = ref.slice(1).split(".");
  let value = head === "item" ? scope.item : scope.outputs[Number(head) - 1];
  for (const part of path) {
    // Only own properties count, never inherited ones such as __proto__.
    if (!isContainer(value) || !Object.hasOwn(value, part)) {
      throw new Failure("reference", `${ref} has no value`);
    }
    value = value[part];
  }
  if (value === undefined) {
    throw new Failure("reference", `${ref} has no value`);
  }
  return value;
}

// Fills in every reference in a value; a string that starts with $$ loses one
// $ (contract-plan.md, References).
function fill(value: unknown, scope: Scope): unknown {
  if (isReference(value)) {
    return resolve(value, scope);
  }
  if (typeof value === "string" && value.startsWith("$$")) {
    return value.slice(1);
  }
  if (Array.isArray(value)) {
    return value.map((item) => fill(item, scope));
  }
  if (isContainer(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fill(item, scope)]),
    );
  }
  return value;
}

async function runCall(
  step: CallStep,
  module: CapabilityModule,
  scope: Scope,
): Promise<unknown> {
  if (!Object.hasOwn(module.capabilities, step.call)) {
    throw new Failure("capability", `no capability ${step.call}`);
  }
  const capability = module.capabilities[step.call];
  const args = fill(step.args, scope) as Record<string, unknown>;
  try {
    checkArgs(args, capability.args);
  } catch (err) {
    throw new Failure("reference", (err as Error).message);
  }
  try {
    return await capability.run(args);
  } catch (err) {
    // A capability's own string code is reported, otherwise `capability`
    // (contract-capability.md, Errors).
    const code =
      isContainer(err) && typeof err.code === "string"
        ? err.code
        : "capability";
    const message = err instanceof Error ? err.message : String(err);
    throw new Failure(code, message);
  }
}

// Runs a plan that passed checkPlan and returns its report.
export async function runPlan(
  plan: Plan,
  module: CapabilityModule,
): Promise<Report> {
  const outputs: unknown[] = [];
  const included: [number, unknown][] = [];
  let halt: Halt | undefined;

  for (const [i, step] of plan.steps.entries()) {
    const number = i + 1;
    try {
      if (isCall(step)) {
        outputs.push(await runCall(step, module, { outputs }));
      } else {
        const items = resolve(step.forEach, { outputs });
        if (!Array.isArray(items)) {
          throw new Failure("reference", `${step.forEach} is not an array`);
        }
        if (items.length > MAX_ITEMS) {
          throw new Failure(
            "limit",
            `${items.length} items, at most ${MAX_ITEMS}`,
          );
        }
        const output: unknown[][] = [];
        for (const [k, item] of items.entries()) {
          const calls: unknown[] = [];
          output.push(calls);
          for (const [j, call] of step.do.entries()) {
            try {
              calls.push(await runCall(call, module, { outputs, item }));
            } catch (err) {
              const failure = err as Failure;
              halt = {
                step: number,
                code: failure.code,
                message: cut(failure.message),
                item: k,
                do: j,
              };
              if (step.includeOutput) {
                halt.outputs = output;
              }
              throw err;
            }
          }
        }
        outputs.push(output);
      }
    } catch (err) {
      if (!(err instanceof Failure)) {
        throw err;
      }
      halt ??= { step: number, code: err.code, message: cut(err.message) };
      break;
    }
    if (step.includeOutput) {
      included.push([number, outputs[i]]);
    }
  }
  return report(included, halt);
}

// Builds the report: included outputs in step order, halt.outputs last, at
// most 16 KB together; one that does not fit is left out with its size.
function report(included: [number, unknown][], halt: Halt | undefined) {
  const result: Report = {};
  let budget = MAX_OUTPUT_BYTES;
  for (const [number, output] of included) {
    const size = bytes(output);
    if (size <= budget) {
      budget -= size;
      result.outputs ??= {};
      result.outputs[number] = output;
    } else {
      result.tooLarge ??= {};
      result.tooLarge[number] = size;
    }
  }
  if (halt?.outputs !== undefined) {
    const size = bytes(halt.outputs);
    if (size > budget) {
      delete halt.outputs;
      halt.tooLarge = size;
    }
  }
  if (halt !== undefined) {
    result.halt = halt;
  }
  return result;
}
