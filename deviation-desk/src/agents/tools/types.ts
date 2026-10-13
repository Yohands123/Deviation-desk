import type { z } from "zod";

/** Passed to every tool by the runner. The model can never set these. */
export interface ToolContext {
  worldId: string;
  companyId: string;
  incidentId: string;
  agentId: string;
}

export interface AgentTool<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  input: I; // validated before run()
  jsonSchema: Record<string, unknown>; // sent to the Claude API as input_schema
  run: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
}
