// The entry module of dicta-action-js. Importing it defines <dicta-action>.

import { DictaAction } from "./element.ts";

if (!customElements.get("dicta-action")) {
  customElements.define("dicta-action", DictaAction);
}

export { dictaCapabilities } from "./builtins.ts";
export { DictaAction };
export type { Capability, CapabilityModule, Level, Schema } from "./module.ts";
