/**
 * Small shared pieces of the live theme (docs/DESIGN.md). Status colour always comes with a word
 * or icon; AI content always carries the diamond marker.
 */
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, Eye, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentCard, DecisionStatus, Severity } from "@/incident-room/types";
import { CONFIDENCE_WORD, confidenceFill, consistentScore } from "@/incident-room/view-model";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const SEVERITY: Record<Severity, { label: string; className: string; icon: typeof Info }> = {
  critical: { label: "Critical", className: "border-critical bg-critical-fill text-critical-text", icon: AlertOctagon },
  warning: { label: "Warning", className: "border-at-risk bg-at-risk-fill text-at-risk-text", icon: AlertTriangle },
  watch: { label: "Watch", className: "border-line bg-panel text-ink", icon: Eye },
  info: { label: "Info", className: "border-line bg-panel text-muted", icon: Info },
};

export function SeverityPill({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  const Icon = s.icon;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", s.className)}>
      <Icon aria-hidden className="size-3.5" />
      {s.label}
    </span>
  );
}

/** Persistent marker that this is the real company, not a drill (trust rule 6). */
export function LiveMarker() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-ink px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-wider text-ink">
      <span aria-hidden className="size-1.5 rounded-full bg-critical" />
      LIVE
    </span>
  );
}

/** Small diamond that marks AI-produced content (trust rule 1). */
export function AiMarker({ label = "AI" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-accent">
      <span aria-hidden className="inline-block size-2 rotate-45 bg-accent" />
      {label}
    </span>
  );
}

export function ConfidenceMeter({ confidence, score }: { confidence: AgentCard["confidence"]; score: number | null }) {
  const fill = Math.round(confidenceFill(confidence, score) * 100);
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${fill}%` }} />
      </span>
      {CONFIDENCE_WORD[confidence]}
      {consistentScore(confidence, score) !== null && <span className="font-mono">({fill}%)</span>}
    </span>
  );
}

const DECISION: Record<DecisionStatus, { label: string; className: string; icon: typeof Info } | null> = {
  none: null,
  pending: { label: "Waiting for a decision", className: "text-at-risk-text", icon: Clock },
  more_evidence: { label: "More evidence requested", className: "text-at-risk-text", icon: Clock },
  approved: { label: "Approved", className: "text-ok", icon: CheckCircle2 },
  rejected: { label: "Rejected", className: "text-critical-text", icon: XCircle },
  override: { label: "Overridden", className: "text-ink", icon: Info },
};

export function DecisionStatusBadge({ status }: { status: DecisionStatus }) {
  const s = DECISION[status];
  if (!s) return null;
  const Icon = s.icon;
  return (
    <span className={cx("inline-flex items-center gap-1 text-xs font-medium", s.className)}>
      <Icon aria-hidden className="size-3.5" />
      {s.label}
    </span>
  );
}

export function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-panel", className)} aria-label={title}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.92em]">{children}</span>;
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
