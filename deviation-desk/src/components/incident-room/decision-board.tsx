"use client";
/**
 * The Decision Board: conflicts between seats, for the Executive to settle. The Event Council
 * (operations, finance and safety advisers) joins it in Phase 7.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SeatRole } from "@/agents/contract";
import { raiseConflict, resolveConflict } from "@/incident-room/actions";
import { LIVE_SEATS, SEAT_LABELS, type ConflictItem } from "@/incident-room/types";
import { cx, timeLabel } from "../ui";

export function DecisionBoard({ code, conflicts, mySeat }: { code: string; conflicts: ConflictItem[]; mySeat: SeatRole | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [withSeat, setWithSeat] = useState<(typeof LIVE_SEATS)[number]>("executive");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const raise = () =>
    start(async () => {
      const res = await raiseConflict({ code, withSeat, summary });
      if (!res.ok) return setError(res.error);
      setError(null);
      setSummary("");
      router.refresh();
    });

  const resolve = (conflictId: string) =>
    start(async () => {
      const res = await resolveConflict({ code, conflictId, note: notes[conflictId] ?? "" });
      if (!res.ok) return setError(res.error);
      setError(null);
      router.refresh();
    });

  const open = conflicts.filter((c) => !c.resolution);
  return (
    <div className="space-y-4">
      {conflicts.length === 0 ? (
        <p className="text-sm text-muted">No conflicts between seats.</p>
      ) : (
        <ul className="space-y-3">
          {conflicts.map((c) => (
            <li key={c.id} className={cx("rounded border p-3 text-sm", c.resolution ? "border-line" : "border-at-risk")}>
              <p className="text-xs text-muted">
                {SEAT_LABELS[c.fromSeat]} ({c.raisedBy}) with {SEAT_LABELS[c.withSeat]} · {timeLabel(c.at)}
              </p>
              <p className="mt-1">{c.summary}</p>
              {c.resolution ? (
                <p className="mt-2 text-ok">
                  Resolved by {c.resolution.by}: {c.resolution.note}
                </p>
              ) : mySeat === "executive" ? (
                <div className="mt-2 flex gap-2">
                  <input
                    value={notes[c.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                    placeholder="Your call, in a sentence"
                    className="min-w-0 flex-1 rounded border border-line px-2 py-1"
                    aria-label="Resolution"
                  />
                  <button disabled={pending || (notes[c.id] ?? "").trim().length < 3} onClick={() => resolve(c.id)} className="rounded bg-ink px-3 py-1 text-panel disabled:opacity-40">
                    Resolve
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-at-risk-text">Waiting for the Executive.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {mySeat && (
        <details className="border-t border-line pt-3" open={open.length === 0 ? undefined : false}>
          <summary className="cursor-pointer text-sm font-medium">Raise a conflict</summary>
          <div className="mt-2 space-y-2">
            <select value={withSeat} onChange={(e) => setWithSeat(e.target.value as typeof withSeat)} className="w-full rounded border border-line px-2 py-1 text-sm" aria-label="With seat">
              {LIVE_SEATS.filter((s) => s !== mySeat).map((s) => (
                <option key={s} value={s}>
                  With the {SEAT_LABELS[s]}
                </option>
              ))}
            </select>
            <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What do you disagree on?" className="w-full rounded border border-line p-2 text-sm" aria-label="Conflict summary" />
            <button disabled={pending || summary.trim().length < 5} onClick={raise} className="rounded border border-ink px-3 py-1.5 text-sm font-medium disabled:opacity-40">
              Send to the Decision Board
            </button>
          </div>
        </details>
      )}
      {error && <p role="status" className="text-sm text-critical-text">{error}</p>}
    </div>
  );
}
