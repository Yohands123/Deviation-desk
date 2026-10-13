"use client";
/**
 * The decision needing you (trust rule 3): the heaviest card on the page. Approving carries out
 * the agent's proposal; rejecting, overriding or asking for more evidence needs a reason.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decide } from "@/incident-room/actions";
import type { AgentCard } from "@/incident-room/types";
import { AiMarker, ConfidenceMeter, cx, DecisionStatusBadge } from "../ui";
import { Advisories } from "./regulatory";
import { SourceChips } from "./source-drawer";

type Outcome = "approved" | "rejected" | "override" | "more_evidence";

const REASON_PROMPTS: Record<Exclude<Outcome, "approved">, { button: string; placeholder: string }> = {
  more_evidence: { button: "Ask for more evidence", placeholder: "What would you need to see before deciding?" },
  rejected: { button: "Reject", placeholder: "Why is this the wrong action?" },
  override: { button: "Override with my own decision", placeholder: "What are you doing instead, and why?" },
};

/** Readable text for one parameter value; `code` marks identifiers, which are set in mono. */
function formatParam(value: unknown): { text: string; code: boolean } {
  if (Array.isArray(value)) {
    const parts = value.map((v) => (v && typeof v === "object" ? formatParam(v).text : String(v)));
    return { text: parts.join(", "), code: true };
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.code === "string") return { text: `${o.code}${typeof o.table === "string" ? ` (${o.table.replace(/_/g, " ").replace(/s$/, "")})` : ""}`, code: true };
    if (typeof o.location === "string" && typeof o.quantity === "number") return { text: `${o.quantity} from ${o.location}`, code: false };
    return { text: JSON.stringify(value), code: true };
  }
  const text = String(value);
  // Prose (a sentence) reads better in the interface font; short tokens are identifiers.
  return { text, code: !/\s/.test(text.trim()) };
}

function ParamsList({ params }: { params: Record<string, unknown> }) {
  const entries = Object.entries(params).filter(([key]) => key !== "message");
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
      {entries.map(([key, value]) => {
        const { text, code } = formatParam(value);
        return (
          <div key={key} className="contents">
            <dt className="capitalize text-muted">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
            <dd className={code ? "font-mono text-[13px]" : undefined}>{text}</dd>
          </div>
        );
      })}
      {typeof params.message === "string" && (
        <div className="col-span-2 mt-1">
          <dt className="text-muted">Draft message</dt>
          <dd className="mt-1 whitespace-pre-wrap rounded border border-line bg-ground p-2">{params.message}</dd>
        </div>
      )}
    </dl>
  );
}

export function DecisionCard({ code, card, world }: { code: string; card: AgentCard; world?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<Exclude<Outcome, "approved"> | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "warning"; text: string } | null>(null);

  const submit = (outcome: Outcome) =>
    start(async () => {
      setMessage(null);
      const res = await decide({ code, decisionRecordId: card.decisionRecordId, outcome, reason: outcome === "approved" ? undefined : reason, world });
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      if (res.warning) setMessage({ tone: "warning", text: res.warning });
      setAsking(null);
      setReason("");
      router.refresh();
    });

  return (
    <article className="rounded-lg border-2 border-ink bg-panel p-4 shadow-sm" aria-label={`Decision: ${card.action?.label ?? card.summary}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide">Decision needed</p>
        <DecisionStatusBadge status={card.status} />
      </div>
      <h3 className="text-lg font-semibold leading-snug">{card.action?.label}</h3>

      <div className="mt-3 rounded-md bg-ai-tint p-3">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <AiMarker label={`Proposed by ${card.agentName}`} />
          <ConfidenceMeter confidence={card.confidence} score={card.confidenceScore} />
        </div>
        <p className="text-sm">{card.summary}</p>
        {card.action && (
          <div className="mt-3">
            <ParamsList params={card.action.params} />
          </div>
        )}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">Reasoning and alternatives</summary>
          <p className="mt-2 whitespace-pre-wrap">{card.reasoning}</p>
          {card.alternatives.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {card.alternatives.map((a) => (
                <li key={a.summary}>
                  {a.summary} <span className="text-muted">— {a.whyNotChosen}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
        <div className="mt-3">
          <SourceChips sources={card.sources} />
        </div>
      </div>
      <Advisories items={card.advisories} />

      {card.decision && card.status === "more_evidence" && (
        <p className="mt-3 text-sm text-muted">
          {card.decision.by ?? "An AI seat"} asked: {card.decision.reason}
        </p>
      )}

      {asking ? (
        <div className="mt-4 space-y-2">
          <label className="block text-sm font-medium" htmlFor={`reason-${card.decisionRecordId}`}>
            {REASON_PROMPTS[asking].button}
          </label>
          <textarea
            id={`reason-${card.decisionRecordId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={REASON_PROMPTS[asking].placeholder}
            rows={3}
            className="w-full rounded border border-line p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              disabled={pending || reason.trim().length < 3}
              onClick={() => submit(asking)}
              className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-panel disabled:opacity-40"
            >
              {pending ? "Saving…" : `Send: ${REASON_PROMPTS[asking].button.toLowerCase()}`}
            </button>
            <button onClick={() => setAsking(null)} className="rounded px-3 py-1.5 text-sm text-muted hover:bg-ground">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={pending}
            onClick={() => submit("approved")}
            className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-panel disabled:opacity-40"
          >
            {pending ? "Saving…" : `Approve: ${card.action?.label.toLowerCase()}`}
          </button>
          {(["more_evidence", "rejected", "override"] as const).map((o) => (
            <button key={o} onClick={() => setAsking(o)} className="rounded border border-line px-3 py-1.5 text-sm hover:border-ink">
              {REASON_PROMPTS[o].button}
            </button>
          ))}
        </div>
      )}
      {message && (
        <p role="status" className={cx("mt-3 text-sm", message.tone === "error" ? "text-critical-text" : "text-at-risk-text")}>
          {message.text}
        </p>
      )}
    </article>
  );
}
