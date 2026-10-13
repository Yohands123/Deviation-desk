/**
 * The shape the model is constrained to via structured outputs, and its conversion into the
 * contract's AgentAnswer. Structured outputs need every field present (nullable instead of
 * optional) and reject open-ended objects, so proposedAction.params travels as a JSON string.
 * contract.ts stays the source of truth; this is only the wire format.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { AgentAnswer, SeatRole } from "./contract";

export const AgentAnswerWire = z.object({
  kind: z.enum(["finding", "proposal", "question", "insufficient_evidence"]),
  summary: z.string().describe("One plain-language sentence, at most 300 characters."),
  reasoning: z.string().describe("Short explanation a QA director can follow, at most 2000 characters. Every claim backed by a source."),
  sources: z.array(
    z.object({
      table: z.string().describe("Table the row came from, exactly as returned by a tool."),
      rowId: z.string().describe("The row's id exactly as returned by a tool."),
      note: z.string().describe("What this row shows."),
    }),
  ),
  confidence: z.enum(["high", "medium", "low", "insufficient"]),
  confidenceScore: z.number().nullable().describe("0 to 1, or null."),
  alternatives: z.array(z.object({ summary: z.string(), whyNotChosen: z.string() })),
  requiresApproval: z.boolean(),
  approvalSeat: SeatRole.nullable(),
  proposedAction: z
    .object({
      type: z.string(),
      paramsJson: z.string().describe('Action parameters as a JSON object string, e.g. {"batch":"A-2231"}.'),
    })
    .nullable(),
});
export type AgentAnswerWire = z.infer<typeof AgentAnswerWire>;

export const ANSWER_FORMAT = zodOutputFormat(AgentAnswerWire);

const ParamsObject = z.record(z.string(), z.unknown());

/** Parses the model's final text into a validated AgentAnswer. Throws with a readable message. */
export function parseAnswer(text: string): AgentAnswer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The answer is not valid JSON.");
  }
  const wire = AgentAnswerWire.parse(raw);
  let params: Record<string, unknown> = {};
  if (wire.proposedAction) {
    let parsedParams: unknown;
    try {
      parsedParams = JSON.parse(wire.proposedAction.paramsJson || "{}");
    } catch {
      throw new Error("proposedAction.paramsJson is not valid JSON.");
    }
    params = ParamsObject.parse(parsedParams);
  }
  return AgentAnswer.parse({
    kind: wire.kind,
    summary: wire.summary,
    reasoning: wire.reasoning,
    sources: wire.sources,
    confidence: wire.confidence,
    confidenceScore: wire.confidenceScore ?? undefined,
    alternatives: wire.alternatives,
    requiresApproval: wire.requiresApproval,
    approvalSeat: wire.approvalSeat ?? undefined,
    proposedAction: wire.proposedAction ? { type: wire.proposedAction.type, params } : undefined,
  });
}
