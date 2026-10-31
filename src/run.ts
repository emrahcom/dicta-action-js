// The plan runner: it runs a checked plan with the module's capabilities and
// builds the report (contract-plan.md, Steps, Include output, References,
// Failures, Limits; contract-protocol.md, Report).

import type { Capability, CapabilityModule } from "./module.ts";
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

type Halt = {
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

export function bytes(value: unknown) {
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

// A call with its capability and its filled-in, checked arguments.
type Prepared = { capability: Capability; args: Record<string, unknown> };

function capabilityOf(step: CallStep, module: CapabilityModule) {
  if (!Object.hasOwn(module.capabilities, step.call)) {
    throw new Failure("capability", `no capability ${step.call}`);
  }
  return module.capabilities[step.call];
}

function prepare(
  step: CallStep,
  module: CapabilityModule,
  scope: Scope,
): Prepared {
  const capability = capabilityOf(step, module);
  const args = fill(step.args, scope) as Record<string, unknown>;
  try {
    checkArgs(args, capability.args);
  } catch (err) {
    throw new Failure("reference", (err as Error).message);
  }
  return { capability, args };
}

// A capability's own string code is reported, otherwise `capability`
// (contract-capability.md, Errors).
function capabilityFailure(err: unknown) {
  const code =
    isContainer(err) && typeof err.code === "string" ? err.code : "capability";
  const message = err instanceof Error ? err.message : String(err);
  return new Failure(code, message);
}

async function execute({ capability, args }: Prepared) {
  try {
    return await capability.run(args);
  } catch (err) {
    throw capabilityFailure(err);
  }
}

// The confirmation text from the capability's confirm. A confirm that throws,
// or a missing one, fails the step as if run had thrown.
async function confirmText({ capability, args }: Prepared) {
  if (!capability.confirm) {
    throw new Failure("capability", "the capability has no confirm");
  }
  try {
    return await capability.confirm(args);
  } catch (err) {
    throw capabilityFailure(err);
  }
}

// What the user is asked: for each item shown, the texts of its calls that
// ask, and the number of items when not all are shown (contract-plan.md,
// Confirmation).
export type Confirmation = { items: string[][]; count?: number };

// Asks the user; true is Continue, false is Cancel.
type Ask = (confirmation: Confirmation) => Promise<boolean>;

// The plan stops early, by added text or cancel; its halt is already set.
class Stopped extends Error {}

// Why a plan stops early at the next step or item: added text or cancel
// (contract-protocol.md, Added text and cancel).
export type Stop = "interrupted" | "cancelled";

export const STOP_MESSAGES: Record<Stop, string> = {
  interrupted: "The user added text",
  cancelled: "Cancelled",
};

function stopHalt(step: number, code: Stop): Halt {
  return { step, code, message: STOP_MESSAGES[code] };
}

// A page load started during a step: nothing after it runs
// (contract-protocol.md, Page changes).
const NAVIGATED_MESSAGE = "The page changed";

const SHOWN_ITEMS = 3;
const DEFAULT_CONFIRM_OVER = 10;

// Whether a call asks: a destructive or external one always, a write one in a
// forEach of more items than confirmOver.
function asks(capability: Capability, items?: number, confirmOver = 0) {
  return (
    capability.level === "destructive" ||
    capability.level === "external" ||
    (capability.level === "write" && items !== undefined && items > confirmOver)
  );
}

// Where a running plan is, for a page change in the middle of it
// (contract-protocol.md, Page changes): the step, and in a forEach the item
// and call; whether a call runs now; and the outputs so far.
export type Progress = {
  step: number;
  item?: number;
  do?: number;
  running: boolean;
  included: [number, unknown][];
  // The forEach's output so far, when its step has includeOutput.
  output?: unknown[][];
};

export function newProgress(): Progress {
  return { step: 1, running: false, included: [] };
}

// The report of a plan stopped where it is now, with the halt `code`, for a
// page left while a step runs: that step may or may not have finished.
export function reportSoFar(
  progress: Progress,
  code: string,
  message: string,
): Report {
  const halt: Halt = { step: progress.step, code, message };
  if (progress.item !== undefined) {
    halt.item = progress.item;
    halt.do = progress.do;
    if (progress.output !== undefined) {
      halt.outputs = progress.output;
    }
  }
  // A copy, since the plan's arrays may still change.
  return JSON.parse(JSON.stringify(report(progress.included, halt))) as Report;
}

// Runs a plan that passed checkPlan and returns its report. When the user
// cancels at a confirmation, the halt has the code `cancelled`. `stop` is
// asked between steps, and in a forEach between items; a step or an item that
// started always finishes. `pageLoad` is asked after each step, and in a
// forEach after each call: when a page load started, nothing after it runs and
// the halt has the code `navigated` at the first step, item or call left, or
// there is no halt when none is left.
export async function runPlan(
  plan: Plan,
  module: CapabilityModule,
  ask: Ask,
  stop: () => Stop | undefined,
  progress: Progress,
  pageLoad: () => boolean | Promise<boolean>,
): Promise<Report> {
  const outputs: unknown[] = [];
  const included = progress.included;
  const confirmOver = module.confirmOver ?? DEFAULT_CONFIRM_OVER;
  let halt: Halt | undefined;

  for (const [i, step] of plan.steps.entries()) {
    const number = i + 1;
    progress.step = number;
    progress.item = undefined;
    progress.do = undefined;
    progress.output = undefined;
    const stopped = stop();
    if (stopped) {
      halt = stopHalt(number, stopped);
      break;
    }
    try {
      if (isCall(step)) {
        const call = prepare(step, module, { outputs });
        if (
          asks(call.capability) &&
          !(await ask({ items: [[await confirmText(call)]] }))
        ) {
          halt = stopHalt(number, "cancelled");
          throw new Stopped();
        }
        outputs.push(await running(progress, () => execute(call)));
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
        const asking = step.do.map((call) =>
          asks(capabilityOf(call, module), items.length, confirmOver),
        );
        // When the step asks, the arguments of every item are filled in and
        // checked first, so a bad item halts it before the user is asked.
        let prepared: Prepared[][] | undefined;
        if (items.length > 0 && asking.includes(true)) {
          prepared = items.map((item) =>
            step.do.map((call) => prepare(call, module, { outputs, item })),
          );
          const shown: string[][] = [];
          for (const calls of prepared.slice(0, SHOWN_ITEMS)) {
            const texts: string[] = [];
            for (const [j, call] of calls.entries()) {
              if (asking[j]) {
                texts.push(await confirmText(call));
              }
            }
            shown.push(texts);
          }
          const count =
            items.length > SHOWN_ITEMS ? { count: items.length } : {};
          if (!(await ask({ items: shown, ...count }))) {
            halt = stopHalt(number, "cancelled");
            throw new Stopped();
          }
        }
        const output: unknown[][] = [];
        if (step.includeOutput) {
          progress.output = output;
        }
        for (const [k, item] of items.entries()) {
          const itemStopped = k > 0 ? stop() : undefined;
          if (itemStopped) {
            // The items that ran are all complete, so `do` is not set.
            halt = { ...stopHalt(number, itemStopped), item: k };
            if (step.includeOutput) {
              halt.outputs = output;
            }
            throw new Stopped();
          }
          const calls: unknown[] = [];
          output.push(calls);
          for (const [j, call] of step.do.entries()) {
            progress.item = k;
            progress.do = j;
            try {
              calls.push(
                await running(progress, () =>
                  execute(
                    prepared?.[k][j] ??
                      prepare(call, module, { outputs, item }),
                  ),
                ),
              );
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
            const lastCall = j === step.do.length - 1;
            if (!(lastCall && k === items.length - 1) && (await pageLoad())) {
              // The next call, or the first call of the next item.
              halt = {
                step: number,
                code: "navigated",
                message: NAVIGATED_MESSAGE,
                item: lastCall ? k + 1 : k,
                do: lastCall ? 0 : j + 1,
              };
              if (step.includeOutput) {
                halt.outputs = lastCall ? [...output, []] : output;
              }
              throw new Stopped();
            }
          }
        }
        outputs.push(output);
      }
    } catch (err) {
      if (err instanceof Stopped) {
        break;
      }
      if (!(err instanceof Failure)) {
        throw err;
      }
      halt ??= { step: number, code: err.code, message: cut(err.message) };
      break;
    }
    if (step.includeOutput) {
      included.push([number, outputs[i]]);
    }
    if (await pageLoad()) {
      if (number < plan.steps.length) {
        halt = {
          step: number + 1,
          code: "navigated",
          message: NAVIGATED_MESSAGE,
        };
      }
      break;
    }
  }
  return report(included, halt);
}

// Marks a call as running while it runs.
async function running<T>(progress: Progress, call: () => Promise<T>) {
  progress.running = true;
  try {
    return await call();
  } finally {
    progress.running = false;
  }
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
