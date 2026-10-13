"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestAudit } from "@/drills/actions";

/** The Auditor's review runs a deep model, so a person asks for it. */
export function AskAuditor({ drillRunId, requested, hasReview }: { drillRunId: string; requested: boolean; hasReview: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (hasReview) return null;
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-critical-text">{error}</span>}
      <button
        disabled={pending || requested}
        onClick={() =>
          start(async () => {
            const res = await requestAudit(drillRunId);
            setError(res.ok ? null : res.error);
            router.refresh();
          })
        }
        className="rounded border border-line px-2.5 py-1 text-xs hover:border-ink disabled:opacity-50"
        title="Runs the Auditor agent (about $0.30)"
      >
        {requested ? "Review requested" : "Ask the Auditor"}
      </button>
    </span>
  );
}
