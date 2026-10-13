/**
 * The Auditor's latest word on this incident: sweep findings while it is open, and the graded
 * review once it closes. Falls back to a note when the Auditor has not reviewed it yet.
 */
import type { AgentCard } from "@/incident-room/types";
import { timeLabel } from "../ui";

export function AuditorPanel({ cards, note }: { cards: AgentCard[]; note: string }) {
  const latest = cards.filter((c) => c.agentId === "auditor").at(-1);
  const params = latest?.action?.params ?? {};
  const grade = typeof params.teamGrade === "string" ? params.teamGrade : null;
  const fixes = Array.isArray(params.topFixes) ? (params.topFixes as string[]) : [];
  return (
    <section className="rounded-lg border border-line bg-auditor-bg p-4" aria-label="Auditor">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-auditor">Auditor</h2>
        {latest && (
          <time className="font-mono text-[11px] text-muted" dateTime={latest.createdAt}>
            {timeLabel(latest.createdAt)}
          </time>
        )}
      </div>
      {latest ? (
        <div className="mt-1 space-y-2 text-sm">
          {grade && (
            <p>
              <span className="text-muted">Team grade:</span> <span className="font-semibold">{grade}</span>
            </p>
          )}
          <p>{latest.summary}</p>
          {fixes.length > 0 && (
            <ol className="list-decimal space-y-0.5 pl-5 text-xs">
              {fixes.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted">{note}</p>
      )}
    </section>
  );
}
