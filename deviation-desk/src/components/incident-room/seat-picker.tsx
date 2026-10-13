"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SeatRole } from "@/agents/contract";
import { takeSeatAction } from "@/incident-room/actions";
import type { SeatView } from "@/incident-room/types";
import { AiMarker, cx } from "../ui";

const SEAT_JOBS: Partial<Record<SeatRole, string>> = {
  qa_director: "Root cause, holds, CAPA",
  plant_manager: "Lines, staffing, halt and restart",
  supply_chain_lead: "Stock, shipments, suppliers",
  regulatory_affairs: "Whether reporting applies, deadlines",
  clinical_ops: "Trial sites and their supply",
  executive: "Big trade-offs and conflicts",
  strategy_growth: "Expansion and long-term risk",
  observer: "Watch without deciding",
};

/** Pick a seat for this incident. Taking a seat moves you out of any other seat on it. */
export function SeatPicker({ code, seats, viewerPersonId }: { code: string; seats: SeatView[]; viewerPersonId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const take = (role: SeatRole) =>
    start(async () => {
      const res = await takeSeatAction(code, role);
      if (!res.ok) return setError(res.error);
      router.push(`/incidents/${code}`);
      router.refresh();
    });

  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {seats.map((s) => {
          const mine = s.holder?.personId === viewerPersonId;
          const taken = Boolean(s.holder) && !mine;
          return (
            <li key={s.role} className={cx("flex flex-col rounded-lg border bg-panel p-4", mine ? "border-ink" : "border-line")}>
              <h3 className="font-semibold">{s.label}</h3>
              <p className="mt-0.5 text-sm text-muted">{SEAT_JOBS[s.role]}</p>
              <div className="mt-3 flex-1 text-sm">{s.holder ? <p>{mine ? "You" : s.holder.name}</p> : <AiMarker label="Played by AI" />}</div>
              {s.pendingDecisions > 0 && <p className="mt-1 text-xs text-at-risk-text">{s.pendingDecisions} decision{s.pendingDecisions > 1 ? "s" : ""} waiting</p>}
              <button
                disabled={pending || taken}
                onClick={() => take(s.role)}
                className="mt-3 rounded bg-ink px-3 py-1.5 text-sm font-medium text-panel disabled:bg-line disabled:text-muted"
              >
                {mine ? "Continue in this seat" : taken ? "Taken" : `Take the ${s.label} seat`}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p role="status" className="mt-3 text-sm text-critical-text">{error}</p>}
    </div>
  );
}
