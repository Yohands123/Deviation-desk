import type { AgentCard as Card } from "@/incident-room/types";
import { AiMarker, ConfidenceMeter, DecisionStatusBadge, timeLabel } from "../ui";
import { SourceChips } from "./source-drawer";

const KIND: Record<Card["kind"], string> = {
  finding: "Finding",
  proposal: "Proposal",
  question: "Question",
  insufficient_evidence: "Not enough evidence",
};

/** An agent's output: tinted, marked as AI, with confidence and one-click sources (trust rules 1–2). */
export function AgentCard({ card }: { card: Card }) {
  return (
    <article className="rounded-md border border-line bg-ai-tint p-3" aria-label={`${card.agentName}: ${card.summary}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <AiMarker label={`${card.agentName} · ${KIND[card.kind]}`} />
        <time className="font-mono text-[11px] text-muted" dateTime={card.createdAt}>
          {timeLabel(card.createdAt)}
        </time>
      </div>
      <p className="text-sm">{card.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <ConfidenceMeter confidence={card.confidence} score={card.confidenceScore} />
        {card.action && card.requiresApproval && (
          <span className="text-xs text-muted">
            {card.action.label} · <DecisionStatusBadge status={card.status} />
          </span>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-muted">Reasoning</summary>
        <p className="mt-1 whitespace-pre-wrap">{card.reasoning}</p>
        {card.decision?.reason && (
          <p className="mt-2 text-muted">
            Decision note ({card.decision.by ?? "AI-played seat"}): {card.decision.reason}
          </p>
        )}
      </details>
      <div className="mt-2">
        <SourceChips sources={card.sources} />
      </div>
      {card.rejectedSourceCount > 0 && (
        <p className="mt-2 text-xs text-at-risk-text">
          {card.rejectedSourceCount} cited source{card.rejectedSourceCount > 1 ? "s" : ""} could not be verified and {card.rejectedSourceCount > 1 ? "were" : "was"} removed.
        </p>
      )}
    </article>
  );
}
