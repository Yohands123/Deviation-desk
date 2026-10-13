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

/** JSON, plus the shared secret when the hosted optimizer requires one (OPTIMIZER_TOKEN). */
function headers(): Record<string, string> {
  const token = process.env.OPTIMIZER_TOKEN;
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

function baseUrl(): string {
  return (process.env.OPTIMIZER_URL || "http://localhost:8001").replace(/\/$/, "");
}

export async function allocate(request: AllocationRequest): Promise<AllocationResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/allocate`, {
      method: "POST",
      headers: headers(),
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

// ─── Scheduling (/schedule) ─────────────────────────────────────────

export interface ScheduleTaskInput {
  id: string;
  duration_hours: number;
  /** Alternatives: exactly one is used. */
  resources: string[];
  earliest_start_hours?: number;
  fixed_start_hours?: number | null;
}

export interface ScheduleRequest {
  horizon_hours: number;
  resources: Array<{ id: string; capacity: number }>;
  jobs: Array<{ id: string; tasks: ScheduleTaskInput[]; due_hours?: number | null; weight?: number }>;
  time_limit_seconds?: number;
}

export const ScheduleResponse = z.object({
  feasible: z.boolean(),
  optimal: z.boolean(),
  jobs: z.array(
    z.object({
      id: z.string(),
      end_hours: z.number().int(),
      lateness_hours: z.number().int(),
      tasks: z.array(z.object({ id: z.string(), resource: z.string(), start_hours: z.number().int(), end_hours: z.number().int() })),
    }),
  ),
  note: z.string(),
});
export type ScheduleResponse = z.infer<typeof ScheduleResponse>;

export async function schedule(request: ScheduleRequest): Promise<ScheduleResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/schedule`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`Optimizer unreachable at ${baseUrl()}. Start it with npm run optimizer.`, { cause: err });
  }
  if (!res.ok) throw new Error(`Optimizer returned ${res.status}: ${await res.text()}`);
  return ScheduleResponse.parse(await res.json());
}
