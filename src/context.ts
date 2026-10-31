// The site context, built from the capability module and sent in every round
// (contract-context.md). The server checks it.

import type { CapabilityModule, Level, Schema } from "./module.ts";

type ContextCapability = {
  name: string;
  level: Level;
  desc: string;
  args?: Schema;
  output?: Schema;
};

export type SiteContext = {
  site: { name: string; desc: string };
  state: { desc: string };
  capabilities: ContextCapability[];
};

export function buildContext(module: CapabilityModule): SiteContext {
  const capabilities = Object.entries(module.capabilities).map(
    ([name, { level, desc, args, output }]) => {
      const entry: ContextCapability = { name, level, desc };
      if (args !== undefined) entry.args = args;
      if (output !== undefined) entry.output = output;
      return entry;
    },
  );
  return {
    site: module.site,
    state: { desc: module.state.desc },
    capabilities,
  };
}
