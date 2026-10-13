/**
 * Client for the optimizer service (services/optimizer, CLAUDE.md principle 10).
 * Shapes mirror the service's Pydantic models; responses are validated before use.
 */
import { z } from "zod";

export interface AllocationSource {
  location_id: string;
  available: number;
  cost_per_unit: number;
  transit_hours: number;
}

export interface AllocationRequest {
  sources: AllocationSource[];
  demand: { order_id: string; quantity: number; due_in_hours: number };
}

export const AllocationResponse = z.object({
  feasible: z.boolean(),
  allocations: z.array(z.object({ location_id: z.string(), quantity: z.number().int() })),
  total_cost: z.number(),
  note: z.string(),
});
export type AllocationResponse = z.infer<typeof AllocationResponse>;

function baseUrl(): string {
  return (process.env.OPTIMIZER_URL || "http://localhost:8001").replace(/\/$/, "");
}

export async function allocate(request: AllocationRequest): Promise<AllocationResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/allocate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`Optimizer unreachable at ${baseUrl()}. Start it with npm run optimizer.`, { cause: err });
  }
  if (!res.ok) throw new Error(`Optimizer returned ${res.status}: ${await res.text()}`);
  return AllocationResponse.parse(await res.json());
}

export async function optimizerIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}
