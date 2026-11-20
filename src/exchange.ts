// Small outputs for the exchange and the history: large outputs of old reports
// move into tooLarge (contract-protocol.md, Request body;
// specs/architecture.md, Storage).

import { bytes, type Report } from "./run.ts";

// The plans whose reports keep every output, counted from the end, and the
// largest output an older report, or a finished request, keeps
// (contract-protocol.md, Request body).
const KEPT_PLANS = 2;
const MAX_SMALL_OUTPUT_BYTES = 512;

// The item with each output over 512 bytes moved into its report's tooLarge,
// or a halt output into halt.tooLarge, with its size. Everything else stays.
export function withSmallOutputs(item: unknown): unknown {
  const { report } = item as { report?: Report };
  if (report === undefined) {
    return item;
  }
  const copy: Report = { ...report };
  if (copy.outputs !== undefined) {
    const outputs: Record<string, unknown> = {};
    for (const [step, output] of Object.entries(copy.outputs)) {
      const size = bytes(output);
      if (size <= MAX_SMALL_OUTPUT_BYTES) {
        outputs[step] = output;
      } else {
        copy.tooLarge = { ...copy.tooLarge, [step]: size };
      }
    }
    if (Object.keys(outputs).length > 0) {
      copy.outputs = outputs;
    } else {
      delete copy.outputs;
    }
  }
  if (copy.halt?.outputs !== undefined) {
    const size = bytes(copy.halt.outputs);
    if (size > MAX_SMALL_OUTPUT_BYTES) {
      const { outputs: _, ...halt } = copy.halt;
      copy.halt = { ...halt, tooLarge: size };
    }
  }
  return { ...(item as object), report: copy };
}

// The exchange with the large outputs of every plan but the last two moved
// into tooLarge (contract-protocol.md, Request body).
export function withoutOldOutputs(exchange: unknown[]): unknown[] {
  const plans = exchange.filter(
    (item) => (item as { report?: unknown }).report !== undefined,
  );
  const old = new Set(plans.slice(0, -KEPT_PLANS));
  return exchange.map((item) =>
    old.has(item) ? withSmallOutputs(item) : item,
  );
}
