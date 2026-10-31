// The capability module: the site's capabilities, its state function and the
// rest of the site context (contract-capability.md).

export type Level = "read" | "write" | "destructive" | "external";

// The JSON Schema keywords a capability may use (contract-capability.md,
// Capabilities).
export type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  description?: string;
};

export type Capability = {
  level: Level;
  desc: string;
  args?: Schema;
  output?: Schema;
  // Method syntax, so a capability may name its own argument type.
  run(args: Record<string, unknown>): Promise<unknown>;
  confirm?(args: Record<string, unknown>): Promise<string>;
};

export type CapabilityModule = {
  site: { name: string; desc: string };
  confirmOver?: number;
  state: {
    desc: string;
    run(): Promise<Record<string, unknown>>;
  };
  capabilities: Record<string, Capability>;
};
