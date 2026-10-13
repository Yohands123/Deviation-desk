/**
 * Regulatory advice and the outbox. Advice is shown as advice (principle 9); messages show exactly
 * what was approved and whether it actually left.
 */
import { Scale } from "lucide-react";
import type { Advisory, MessageStatus, MessageView, ObligationView } from "@/incident-room/types";
import { cx, Mono, timeLabel } from "../ui";

/** Regulator A's notes on a proposal, inside its card. */
export function Advisories({ items }: { items: Advisory[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {items.map((a) => (
        <aside key={a.decisionRecordId} className="rounded-md border border-line bg-panel p-3 text-sm" aria-label={`${a.agentName} advice`}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Scale aria-hidden className="size-3.5" /> {a.agentName} · advice, not a ruling
          </p>
          <p className="mt-1">{a.summary}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted">Why</summary>
            <p className="mt-1 whitespace-pre-wrap">{a.reasoning}</p>
          </details>
        </aside>
      ))}
    </div>
  );
}

const MESSAGE_STATUS: Record<MessageStatus, { label: string; tone: string }> = {
  ready: { label: "Queued to send", tone: "text-muted" },
  sent: { label: "Sent", tone: "text-ok" },
  failed: { label: "Not delivered", tone: "text-critical-text" },
  not_configured: { label: "Approved, not sent (no delivery channel)", tone: "text-at-risk-text" },
  drill: { label: "Drill: recorded, never sent", tone: "text-muted" },
};

function MessageStatusLabel({ status }: { status: MessageStatus }) {
  const s = MESSAGE_STATUS[status];
  return <span className={cx("text-xs", s.tone)}>{s.label}</span>;
}

function dueText(hours: number): { text: string; tone: string } {
  if (hours < 0) return { text: `Overdue by ${Math.abs(hours)} h`, tone: "text-critical-text font-medium" };
  if (hours < 12) return { text: `${hours} h left`, tone: "text-at-risk-text font-medium" };
  return { text: `${hours} h left`, tone: "text-muted" };
}

export function RegulatoryPanel({ obligations, messages }: { obligations: ObligationView[]; messages: MessageView[] }) {
  const fictional = obligations.some((o) => o.fictional);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Reporting obligations</h3>
        {obligations.length === 0 ? (
          <p className="mt-1 text-muted">None confirmed. Regulator B flags possible obligations for Regulatory Affairs to confirm.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {obligations.map((o) => {
              const due = dueText(o.hoursLeft);
              return (
                <li key={o.id} className="rounded border border-line p-2">
                  <p>
                    <Mono>{o.ruleCode}</Mono> {o.title}
                  </p>
                  <p className="text-xs text-muted">{o.authority}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    <span className="font-mono">Due {timeLabel(o.dueAt)}</span>
                    {o.submission ? <MessageStatusLabel status={o.submission.status} /> : <span className={due.tone}>{due.text}</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {fictional && <p className="mt-2 text-xs text-muted">Demo library: these rules are fictional and not legal advice.</p>}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Messages</h3>
        {messages.length === 0 ? (
          <p className="mt-1 text-muted">Nothing approved to send. Drafts wait on the deciding seat&apos;s card.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="rounded border border-line p-2">
                <p className="font-medium">{m.subject}</p>
                <p className="text-xs text-muted">
                  {m.label} · to {m.to.join(", ")}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3">
                  <MessageStatusLabel status={m.status} />
                  {m.lastError && <span className="text-xs text-muted">{m.lastError}</span>}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted">Message as approved</summary>
                  <p className="mt-1 whitespace-pre-wrap rounded bg-ground p-2">{m.body}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
