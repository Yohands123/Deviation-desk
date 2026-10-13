/**
 * Drill workflows: autoplay (one tick every few seconds while the drill runs) and the Auditor's
 * end-of-drill review, which runs only when someone asks for it.
 */
import "server-only";
import { loadAgent } from "@/agents/configs";
import { runAgent } from "@/agents/runner";
import { getSql } from "@/db/client";
import { loadDrillRun } from "@/sim/drill-state";
import { endDrill } from "@/sim/drills";
import { runTick, type TickResult } from "@/sim/tick";
import { inngest } from "./client";
import type { Emitted } from "./events";

/** Events a tick produced, for the workflow engine. Observable ones only reach agents if the drill allows. */
export function tickEvents(result: TickResult, agentsEnabled: boolean): Emitted[] {
  return [...result.followUps, ...(agentsEnabled ? result.observable : [])];
}

/** Safety cap on one autoplay run; a resume starts a fresh run. */
const MAX_AUTOPLAY_TICKS = 200;

export const drillAutoplay = inngest.createFunction(
  { id: "drill-autoplay", triggers: [{ event: "drill/play" }], concurrency: { limit: 1, key: "event.data.drillRunId" } },
  async ({ event, step }) => {
    const drillRunId = String(event.data.drillRunId);
    for (let i = 0; i < MAX_AUTOPLAY_TICKS; i++) {
      const run = await step.run(`load-${i}`, async () => {
        const r = await loadDrillRun(getSql(), drillRunId);
        return { status: r.status, tick: r.tick, secondsPerTick: r.secondsPerTick, agentsEnabled: r.agentsEnabled };
      });
      if (run.status !== "running") return { stoppedAt: run.tick, reason: run.status };
      await step.sleep(`wait-${i}`, `${run.secondsPerTick}s`);
      const result = await step.run(`tick-${i}`, async () => {
        const fresh = await loadDrillRun(getSql(), drillRunId);
        // Paused or ended while we waited: stop without moving the clock.
        if (fresh.status !== "running") return null;
        const r = await runTick(getSql(), drillRunId, run.tick);
        if (r?.reachedEnd) await endDrill(getSql(), drillRunId);
        return r ? { events: tickEvents(r, fresh.agentsEnabled), ended: r.reachedEnd } : null;
      });
      if (result && result.events.length > 0) await step.sendEvent(`emit-${i}`, result.events);
      if (result?.ended) {
        await step.sendEvent(`ended-${i}`, { name: "drill/ended", data: { drillRunId } });
        return { ended: true };
      }
    }
    return { capped: true };
  },
);

export const drillAudit = inngest.createFunction(
  { id: "drill-audit", triggers: [{ event: "drill/audit-requested" }], concurrency: { limit: 1, key: "event.data.drillRunId" } },
  async ({ event, step }) => {
    const drillRunId = String(event.data.drillRunId);
    return step.run("auditor", async () => {
      const sql = getSql();
      const run = await loadDrillRun(sql, drillRunId);
      if (run.status !== "ended") throw new Error("The Auditor reviews a drill only after it ends.");
      const { config, version } = await loadAgent(sql, "auditor");
      const result = await runAgent({
        agent: config,
        agentVersion: version,
        ctx: { worldId: run.worldId, companyId: run.companyId, incidentId: run.incidentId, agentId: "auditor" },
        task: `Review 3 (a drill has ended): the drill "${run.title}" ended after ${run.tick} simulated hours. Review it and grade each seat and the team.`,
      });
      return { decisionRecordId: result.decisionRecordId, status: result.status };
    });
  },
);
