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

// The client's own halt codes (contract-protocol.md, Report).
const CLIENT_CODES = new Set([
  "capability",
  "reference",
  "limit",
  "invalid",
  "cancelled",
  "interrupted",
  "navigated",
]);

const STOP_MESSAGES: Record<Stop, string> = {
  interrupted: "The user added text",
  cancelled: "Cancelled",
};

// A page load started during a step: nothing after it runs
// (contract-protocol.md, Page changes).
const NAVIGATED_MESSAGE = "The page changed";

const SHOWN_ITEMS = 3;
const DEFAULT_CONFIRM_OVER = 10;

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

// The outputs a reference can use: those of the earlier steps, and the item
// inside the do of a forEach.
type Scope = { outputs: unknown[]; item?: unknown };

// A call with its capability and its filled-in, checked arguments.
type Prepared = { capability: Capability; args: Record<string, unknown> };

// What the user is asked: for each item shown, the texts of its calls that
// ask, and the number of items when not all are shown (contract-plan.md,
// Confirmation). A checkpoint has the plan's progress as its one item, or no
// item when the plan has none (contract-plan.md, Checkpoint).
export type Confirmation = {
  items: string[][];
  count?: number;
  checkpoint?: boolean;
};

// Asks the user; true is Continue, false is Cancel.
type Ask = (confirmation: Confirmation) => Promise<boolean>;

// Why a plan stops early at the next step or item: added text or cancel
// (contract-protocol.md, Added text and cancel).
export type Stop = "interrupted" | "cancelled";

// Where a running plan is, for a page change in the middle of it
// (contract-protocol.md, Page changes): the step, and in a forEach the item
// and call; and the outputs so far.
export type Progress = {
  step: number;
  item?: number;
  do?: number;
  // Whether the running or last call may load a page; only then is a page load
  // looked for (contract-capability.md, Page changes).
  pageLoad?: boolean;
  included: [number, unknown][];
  // The forEach's output so far, when its step has includeOutput.
  output?: unknown[][];
};

// What the working view shows while a plan runs: the top-level step that
// runs, and in a forEach how many of all its items are done
// (specs/architecture.md, Display).
export type Shown = { step: number; done?: number; all?: number };

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

// The message of a thrown value, which may be any value.
export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
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

// A capability's own string code is reported, unless it is one of the
// client's own; otherwise `capability` (contract-capability.md, Errors).
function capabilityFailure(err: unknown) {
  const code =
    isContainer(err) &&
    typeof err.code === "string" &&
    !CLIENT_CODES.has(err.code)
      ? err.code
      : "capability";
  return new Failure(code, errorMessage(err));
}

// Runs a call and turns its output into JSON at once, so references and the
// report see the same value (contract-capability.md, Capabilities).
async function execute({ capability, args }: Prepared) {
  let output: unknown;
  try {
    output = await capability.run(args);
  } catch (err) {
    throw capabilityFailure(err);
  }
  try {
    return JSON.parse(JSON.stringify(output) ?? "null") as unknown;
  } catch {
    throw new Failure("capability", "the output is not JSON");
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

function stopHalt(step: number, code: Stop): Halt {
  return { step, code, message: STOP_MESSAGES[code] };
}

// Whether a call asks: a destructive or external one always, a write one in a
// forEach of more items than confirmOver.
function asks(capability: Capability, items?: number, confirmOver = 0) {
  return (
    capability.level === "destructive" ||
    capability.level === "external" ||
    (capability.level === "write" && items !== undefined && items > confirmOver)
  );
}

// The write capabilities called by more top-level steps than confirmOver,
// each with its number of steps (contract-plan.md, Confirmation).
function repeatedWrites(
  plan: Plan,
  module: CapabilityModule,
  confirmOver: number,
) {
  const counts = new Map<string, number>();
  for (const step of plan.steps) {
    if (isCall(step) && capabilityOf(step, module).level === "write") {
      counts.set(step.call, (counts.get(step.call) ?? 0) + 1);
    }
  }
  for (const [name, count] of counts) {
    if (count <= confirmOver) {
      counts.delete(name);
    }
  }
  return counts;
}

export function newProgress(): Progress {
  return { step: 1, included: [] };
}

// The report of a plan stopped where it is now, with the halt `cancelled`, for
// a page left while a step runs: that step may or may not have finished.
export function cancelledReportSoFar(progress: Progress): Report {
  const halt: Halt = {
    step: progress.step,
    code: "cancelled",
    message: STOP_MESSAGES.cancelled,
  };
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

// What the runner asks of its caller while a plan runs. `stop` is asked
// between steps, and in a forEach between items. `pageLoad` is asked after
// each call of a capability that may load a page. `show` gets what the
// working view shows.
type Callbacks = {
  ask: Ask;
  stop: () => Stop | undefined;
  pageLoad: () => boolean | Promise<boolean>;
  show?: (shown: Shown) => void;
};

// What the parts of a running plan share.
type Run = Callbacks & {
  module: CapabilityModule;
  progress: Progress;
  outputs: unknown[];
  confirmOver: number;
};

// A checkpoint asks once, before the plan's first step, ahead of the step's
// own confirmation (contract-plan.md, Checkpoint).
async function askCheckpoint(plan: Plan, ask: Ask): Promise<Halt | undefined> {
  const go = await ask({
    items: plan.progress === undefined ? [] : [[plan.progress]],
    checkpoint: true,
  });
  return go ? undefined : stopHalt(1, "cancelled");
}

// A call step asks when its capability asks, or with `count` when it is the
// first of many steps of one write capability: it asks for all of them
// (contract-plan.md, Confirmation).
async function confirmCall(
  call: Prepared,
  count: number | undefined,
  number: number,
  ask: Ask,
): Promise<Halt | undefined> {
  if (!asks(call.capability) && count === undefined) {
    return undefined;
  }
  const go = await ask({
    items: [[await confirmText(call)]],
    ...(count === undefined ? {} : { count }),
  });
  return go ? undefined : stopHalt(number, "cancelled");
}

// When a forEach asks, the arguments of every item are filled in and checked
// first, so a bad item halts it before the user is asked; the item is named
// in the message, since no item ran. Returns the prepared calls when it
// asked, or the halt when the user cancels.
async function confirmForEach(
  step: ForEachStep,
  items: unknown[],
  number: number,
  run: Run,
): Promise<{ prepared?: Prepared[][]; halt?: Halt }> {
  const { module, outputs } = run;
  const asking = step.do.map((call) =>
    asks(capabilityOf(call, module), items.length, run.confirmOver),
  );
  if (items.length === 0 || !asking.includes(true)) {
    return {};
  }
  const prepared = items.map((item, k) => {
    try {
      return step.do.map((call) => prepare(call, module, { outputs, item }));
    } catch (err) {
      if (err instanceof Failure) {
        throw new Failure(err.code, `item ${k}: ${err.message}`);
      }
      throw err;
    }
  });
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
  const count = items.length > SHOWN_ITEMS ? { count: items.length } : {};
  if (!(await run.ask({ items: shown, ...count }))) {
    return { halt: stopHalt(number, "cancelled") };
  }
  return { prepared };
}

// The halt of a forEach, with its output so far when the step includes it.
function forEachHalt(step: ForEachStep, output: unknown[][], halt: Halt) {
  if (step.includeOutput) {
    halt.outputs = output;
  }
  return halt;
}

// Runs a forEach and adds its output to the outputs, or returns its halt. A
// failure before its first item is thrown.
async function runForEach(
  step: ForEachStep,
  number: number,
  run: Run,
): Promise<Halt | undefined> {
  const { module, outputs, progress } = run;
  const items = resolve(step.forEach, { outputs });
  if (!Array.isArray(items)) {
    throw new Failure("reference", `${step.forEach} is not an array`);
  }
  if (items.length > MAX_ITEMS) {
    throw new Failure("limit", `${items.length} items, at most ${MAX_ITEMS}`);
  }
  const { prepared, halt } = await confirmForEach(step, items, number, run);
  if (halt !== undefined) {
    return halt;
  }
  const output: unknown[][] = [];
  if (step.includeOutput) {
    progress.output = output;
  }
  run.show?.({ step: number, done: 0, all: items.length });
  for (const [k, item] of items.entries()) {
    const stopped = k > 0 ? run.stop() : undefined;
    if (stopped) {
      // The items that ran are all complete, so `do` is not set.
      return forEachHalt(step, output, {
        ...stopHalt(number, stopped),
        item: k,
      });
    }
    const calls: unknown[] = [];
    output.push(calls);
    for (const [j, call] of step.do.entries()) {
      progress.item = k;
      progress.do = j;
      try {
        const next =
          prepared?.[k][j] ?? prepare(call, module, { outputs, item });
        progress.pageLoad = next.capability.pageLoad === true;
        calls.push(await execute(next));
      } catch (err) {
        if (!(err instanceof Failure)) {
          throw err;
        }
        return forEachHalt(step, output, {
          step: number,
          code: err.code,
          message: cut(err.message),
          item: k,
          do: j,
        });
      }
      const lastCall = j === step.do.length - 1;
      if (
        !(lastCall && k === items.length - 1) &&
        progress.pageLoad &&
        (await run.pageLoad())
      ) {
        // The next call, or the first call of the next item.
        return forEachHalt(step, lastCall ? [...output, []] : output, {
          step: number,
          code: "navigated",
          message: NAVIGATED_MESSAGE,
          item: lastCall ? k + 1 : k,
          do: lastCall ? 0 : j + 1,
        });
      }
    }
    run.show?.({ step: number, done: k + 1, all: items.length });
  }
  outputs.push(output);
  return undefined;
}

// Runs a plan that passed checkPlan and returns its report. When the user
// cancels at a confirmation, the halt has the code `cancelled`. A step or an
// item that started always finishes before `stop` ends the plan. When
// `pageLoad` sees a page load, nothing after it runs and the halt has the
// code `navigated` at the first step, item or call left, or there is no halt
// when none is left.
export async function runPlan(
  plan: Plan,
  module: CapabilityModule,
  progress: Progress,
  callbacks: Callbacks,
): Promise<Report> {
  const confirmOver = module.confirmOver ?? DEFAULT_CONFIRM_OVER;
  const outputs: unknown[] = [];
  const included = progress.included;
  const run: Run = { ...callbacks, module, progress, outputs, confirmOver };
  const repeated = repeatedWrites(plan, module, confirmOver);
  let halt: Halt | undefined;

  for (const [i, step] of plan.steps.entries()) {
    const number = i + 1;
    progress.step = number;
    progress.item = undefined;
    progress.do = undefined;
    progress.output = undefined;
    progress.pageLoad = false;
    const stopped = run.stop();
    if (stopped) {
      halt = stopHalt(number, stopped);
      break;
    }
    if (i === 0 && plan.checkpoint === true) {
      halt = await askCheckpoint(plan, run.ask);
      if (halt !== undefined) {
        break;
      }
    }
    try {
      if (isCall(step)) {
        const call = prepare(step, module, { outputs });
        const count = repeated.get(step.call);
        repeated.delete(step.call);
        halt = await confirmCall(call, count, number, run.ask);
        if (halt === undefined) {
          progress.pageLoad = call.capability.pageLoad === true;
          run.show?.({ step: number });
          outputs.push(await execute(call));
        }
      } else {
        halt = await runForEach(step, number, run);
      }
    } catch (err) {
      if (!(err instanceof Failure)) {
        throw err;
      }
      halt = { step: number, code: err.code, message: cut(err.message) };
    }
    if (halt !== undefined) {
      break;
    }
    if (step.includeOutput) {
      included.push([number, outputs[i]]);
    }
    if (progress.pageLoad && (await run.pageLoad())) {
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
