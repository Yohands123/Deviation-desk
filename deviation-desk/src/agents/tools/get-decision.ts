import { z } from "zod";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

const input = z.object({ decisionRecordId: z.uuid().describe("The decision record id named in your task.") });

export const getDecision: AgentTool<typeof input> = {
  name: "get_decision",
  description:
    'Read another agent\'s decision record by id (for example the signal that confirmed a trend): which agent, its summary, reasoning and sources. Cite it as table "decision_records".',
  input,
  async run({ decisionRecordId }, ctx) {
    const [row] = await getSql()<{ id: string; agentId: string; record: { answer: unknown }; createdAt: Date }[]>`
      select id, agent_id, record, created_at from decision_records where world_id = ${ctx.worldId} and id = ${decisionRecordId}`;
    if (!row) throw new Error(`No decision record ${decisionRecordId} in this world.`);
    return { citeAs: "decision_records", id: row.id, agentId: row.agentId, createdAt: row.createdAt, answer: row.record.answer };
  },
};
