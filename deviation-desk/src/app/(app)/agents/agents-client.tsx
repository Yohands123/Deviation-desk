"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideLessonAction, runLearningNow } from "@/learning/actions";

export function RunLearning() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await runLearningNow();
            setMessage(res.ok ? (res.message ?? "Started.") : res.error);
            router.refresh();
          })
        }
        className="rounded border border-ink px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        title="Runs the Learning Loop (deep model, about $0.30) if there is pushback to learn from"
      >
        Run the Learning Loop now
      </button>
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}

export function DecideLesson({ lessonId, status }: { lessonId: string; status: "proposed" | "active" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decide = (outcome: "active" | "rejected" | "retired") =>
    start(async () => {
      const res = await decideLessonAction({ lessonId, outcome, reason });
      setError(res.ok ? null : res.error);
      router.refresh();
    });
  return (
    <div className="mt-2 space-y-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={status === "proposed" ? "Reason (required to reject)" : "Reason for retiring it"}
        className="w-full rounded border border-line bg-panel px-2 py-1 text-sm"
        aria-label="Reason"
      />
      <div className="flex flex-wrap gap-2">
        {status === "proposed" ? (
          <>
            <button disabled={pending} onClick={() => decide("active")} className="rounded bg-ink px-3 py-1 text-sm font-medium text-panel disabled:opacity-40">
              Approve: add to the agent
            </button>
            <button disabled={pending || reason.trim().length < 3} onClick={() => decide("rejected")} className="rounded border border-line px-3 py-1 text-sm disabled:opacity-40">
              Reject
            </button>
          </>
        ) : (
          <button disabled={pending || reason.trim().length < 3} onClick={() => decide("retired")} className="rounded border border-line px-3 py-1 text-sm disabled:opacity-40">
            Retire
          </button>
        )}
      </div>
      {error && <p className="text-sm text-critical-text">{error}</p>}
    </div>
  );
}
