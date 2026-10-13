/**
 * Tools agents may call. Rules:
 * - Every query filters by ctx.worldId. A world id never comes from the model.
 * - The model never writes SQL. Tools expose allow-listed, parameterized queries only.
 * - Results are trimmed to what the agent needs (limits on rows and fields).
 * - Rows returned include their id so agents can cite them as sources.
 */
import { findOpenIncidents } from "./find-open-incidents";
import { getApprovedSuppliers } from "./get-approved-suppliers";
import { getDecision } from "./get-decision";
import { getIncident } from "./get-incident";
import { getInventory } from "./get-inventory";
import { getRecords } from "./get-records";
import { getSensorHistory } from "./get-sensor-history";
import { getShipmentTelemetry } from "./get-shipment-telemetry";
import { listAgents } from "./list-agents";
import { listEvidence } from "./list-evidence";
import { optimizeRoutes } from "./optimize-routes";
import { queryTwin } from "./query-twin";
import { searchSops } from "./search-sops";
import { traceImpact } from "./trace-impact";
import type { AgentTool } from "./types";

// Each tool's run() is typed for its own input; the registry erases that, and the loop
// validates input with tool.input before calling run().
const all = [
  queryTwin,
  traceImpact,
  getIncident,
  listEvidence,
  searchSops,
  getSensorHistory,
  findOpenIncidents,
  listAgents,
  getRecords,
  getInventory,
  getShipmentTelemetry,
  getApprovedSuppliers,
  optimizeRoutes,
  getDecision,
] as unknown as AgentTool[];

/** Registry of all tools by name. Agents only receive the ones in their allowedTools. */
export const tools: Readonly<Record<string, AgentTool>> = Object.fromEntries(all.map((t) => [t.name, t]));
