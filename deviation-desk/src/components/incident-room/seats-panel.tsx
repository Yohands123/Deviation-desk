import Link from "next/link";
import type { SeatRole } from "@/agents/contract";
import { SEAT_LABELS, type SeatView } from "@/incident-room/types";
import { AiMarker } from "../ui";

export function YourSeat({ code, mySeat, seats }: { code: string; mySeat: SeatRole | null; seats: SeatView[] }) {
  const seat = seats.find((s) => s.role === mySeat);
  return (
    <div>
      <p className="text-xs text-muted">Your seat</p>
      <p className="text-base font-semibold">{mySeat ? SEAT_LABELS[mySeat] : "None yet"}</p>
      {seat && seat.agents.length > 0 && (
        <p className="mt-1 text-xs text-muted">Agents working for you: {seat.agents.join(", ")}</p>
      )}
      <Link href={`/incidents/${code}?seat=choose`} className="mt-2 inline-block text-sm text-accent underline-offset-2 hover:underline">
        Change seat
      </Link>
    </div>
  );
}

/** Everyone in the room: people by seat, and the seats AI is playing. */
export function PeopleInRoom({ seats }: { seats: SeatView[] }) {
  return (
    <ul className="space-y-2">
      {seats.map((s) => (
        <li key={s.role} className="flex items-start justify-between gap-2 text-sm">
          <div>
            <p className="font-medium">{s.label}</p>
            {s.holder ? <p className="text-muted">{s.holder.name}</p> : <AiMarker label="Played by AI" />}
          </div>
          {s.pendingDecisions > 0 && (
            <span className="shrink-0 rounded-full bg-at-risk-fill px-2 py-0.5 text-xs text-at-risk-text">
              {s.pendingDecisions} waiting
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
