/**
 * The agent contract. Single source of truth for agent outputs and configs.
 * See CLAUDE.md §7. Import these; never redefine the shapes elsewhere.
 */
import { z } from "zod";

export const SeatRole = z.enum([
  "qa_director",
  "plant_manager",
  "supply_chain_lead",
  "regulatory_affairs",
  "clinical_ops",
  "executive",
  "strategy_growth",
  "observer",
  "facilitator",
]);
export type SeatRole = z.infer<typeof SeatRole>;

export const Source = z.object({
  table: z.string().min(1),
  rowId: z.string().min(1),
  note: z.string().min(1),
});

export const Alternative = z.object({
  summary: z.string().min(1),
  whyNotChosen: z.string().min(1),
});

export const ProposedAction = z.object({
  type: z.string().min(1), // must map to an approving seat (docs/AGENTS.md §Approvals)
  params: z.record(z.string(), z.unknown()),
});

/** What the model must return. The runner adds agentId, incidentId and worldId itself. */
export const AgentAnswer = z
  .object({
    kind: z.enum(["finding", "proposal", "question", "insufficient_evidence"]),
    summary: z.string().min(1).max(300),
    reasoning: z.string().min(1).max(2000),
    sources: z.array(Source),
    confidence: z.enum(["high", "medium", "low", "insufficient"]),
    confidenceScore: z.number().min(0).max(1).optional(),
    alternatives: z.array(Alternative).default([]),
    requiresApproval: z.boolean(),
    approvalSeat: SeatRole.optional(),
    proposedAction: ProposedAction.optional(),
  })
  .superRefine((a, ctx) => {
    if (a.kind !== "insufficient_evidence" && a.sources.length === 0) {
      ctx.addIssue({ code: "custom", message: "Findings and proposals must cite at least one source." });
    }
    if (a.requiresApproval && (!a.approvalSeat || !a.proposedAction)) {
      ctx.addIssue({ code: "custom", message: "Approval-requiring answers need approvalSeat and proposedAction." });
    }
  });
export type AgentAnswer = z.infer<typeof AgentAnswer>;

export const DecisionRecord = z.object({
  agentId: z.string(),
  incidentId: z.string(),
  worldId: z.string(),
  answer: AgentAnswer,
});
export type DecisionRecord = z.infer<typeof DecisionRecord>;

export const ModelTier = z.enum(["fast", "standard", "deep"]);
export type ModelTier = z.infer<typeof ModelTier>;

export const AgentConfig = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  department: z.enum([
    "early_warning",
    "triage",
    "investigation",
    "containment",
    "logistics",
    "regulatory",
    "council",
    "communications",
    "expansion",
    "drill",
    "oversight",
  ]),
  seat: SeatRole,
  modelTier: ModelTier,
  job: z.string(), // one sentence
  systemPrompt: z.string(),
  limits: z.array(z.string()).min(1), // things it must never do
  allowedTools: z.array(z.string()),
  triggers: z.array(z.string()), // event names
  maxToolCalls: z.number().int().positive().default(8),
  maxTokens: z.number().int().positive().default(2000),
  costBudgetUsd: z.number().positive().default(0.5),
  drillOnly: z.boolean().default(false),
});
export type AgentConfig = z.infer<typeof AgentConfig>;
