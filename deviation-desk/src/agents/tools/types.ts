import type { z } from "zod";

/** Passed to every tool by the runner. The model can never set these. */
export interface ToolContext {
  worldId: string;
  companyId: string;
  /** Null when the agent runs before an incident exists (e.g. the Signal Watcher). */
  incidentId: string | null;
  agentId: string;
}

export interface AgentTool<I extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** Validates the model's input before run(). Also the source of the JSON schema sent to the API. */
  input: I;
  run: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
}
