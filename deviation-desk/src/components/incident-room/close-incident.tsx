"use client";
/** The QA Director closes the incident, with a reason; the Auditor then grades the response. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeIncident } from "@/incident-room/actions";

export function CloseIncident({ code, world }: { code: string; world: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <details className="rounded-lg border border-line bg-panel p-4">
      <summary className="cursor-pointer text-sm font-medium">Close the incident</summary>
      <div className="mt-2 space-y-2">
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why it can close: containment done, root cause accepted, CAPA opened…"
          className="w-full rounded border border-line p-2 text-sm"
          aria-label="Reason for closing"
        />
        <button
          disabled={pending || reason.trim().length < 5}
          onClick={() =>
            start(async () => {
              const res = await closeIncident({ code, reason, world });
              setMessage(res.ok ? (res.warning ?? "Closed. The Auditor will grade the response.") : res.error);
              router.refresh();
            })
          }
          className="rounded border border-ink px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          Close incident
        </button>
        {message && (
          <p role="status" className="text-sm text-muted">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
