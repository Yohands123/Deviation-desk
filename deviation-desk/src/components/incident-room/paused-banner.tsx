"use client";
/** Shown while the incident is paused: why, and (for the Executive) the way to resume it. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SeatRole } from "@/agents/contract";
import { resumeIncident } from "@/incident-room/actions";
import { timeLabel } from "../ui";

export function PausedBanner({ code, paused, mySeat, world }: { code: string; paused: { reason: string; at: string }; mySeat: SeatRole | null; world: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div role="status" className="border-b border-at-risk bg-at-risk-fill px-4 py-2 text-sm text-at-risk-text">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1">
          <span className="font-medium">Paused</span> since {timeLabel(paused.at)}{paused.reason ? `: ${paused.reason}` : "."} Agent work waits; people can still decide.
        </p>
        {mySeat === "executive" && (
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await resumeIncident({ code, world });
                setMessage(res.ok ? (res.warning ?? null) : res.error);
                router.refresh();
              })
            }
            className="rounded border border-at-risk-text px-3 py-1 font-medium disabled:opacity-50"
          >
            Resume
          </button>
        )}
        {message && <p className="w-full text-xs">{message}</p>}
      </div>
    </div>
  );
}
