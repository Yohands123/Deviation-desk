"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { askLaunchPlanner, decideExpansion, runReviewNow, simulateAgain } from "@/expansion/actions";

type Message = { tone: "ok" | "error"; text: string } | null;

function Status({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role="status" className={message.tone === "error" ? "text-sm text-critical-text" : "text-sm text-muted"}>
      {message.text}
    </p>
  );
}

export function RunReview() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<Message>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await runReviewNow();
            setMessage(res.ok ? { tone: "ok", text: res.message ?? "Started." } : { tone: "error", text: res.error });
            router.refresh();
          })
        }
        className="rounded bg-ink px-4 py-2 text-sm font-medium text-panel disabled:opacity-40"
        title="Runs five agents (about $0.60)"
      >
        Run the weekly review now
      </button>
      <Status message={message} />
    </div>
  );
}

export function SimulateAgain({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<Message>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await simulateAgain(proposalId);
            setMessage(res.ok ? null : { tone: "error", text: res.error });
            router.refresh();
          })
        }
        className="rounded border border-line px-2.5 py-1 text-xs hover:border-ink disabled:opacity-50"
        title="Runs the stress tests on today's company, with and without the change. No model cost."
      >
        {pending ? "Simulating… (about 30 s)" : "Simulate again"}
      </button>
      <Status message={message} />
    </span>
  );
}

export function DecideProposal({ proposalId, label }: { proposalId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const decide = (outcome: "approved" | "rejected") =>
    start(async () => {
      const res = await decideExpansion({ proposalId, outcome, reason });
      setMessage(res.ok ? { tone: "ok", text: res.message ?? "Recorded." } : { tone: "error", text: res.error });
      router.refresh();
    });
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor={`reason-${proposalId}`}>
        {label}
      </label>
      <input
        id={`reason-${proposalId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Your reason (required to reject)"
        className="w-full rounded border border-line bg-panel px-2 py-1 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <button disabled={pending} onClick={() => decide("approved")} className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-panel disabled:opacity-40">
          Approve
        </button>
        <button disabled={pending || reason.trim().length < 3} onClick={() => decide("rejected")} className="rounded border border-line px-3 py-1.5 text-sm hover:border-ink disabled:opacity-40">
          Reject
        </button>
      </div>
      <Status message={message} />
    </div>
  );
}

export function AskLaunchPlanner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<Message>(null);
  return (
    <div className="space-y-2">
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What would it take to… (e.g. supply HLX-201 to hospital pharmacies in a second country)"
        className="w-full rounded border border-line bg-panel p-2 text-sm"
        aria-label="Launch question"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || text.trim().length < 10}
          onClick={() =>
            start(async () => {
              const res = await askLaunchPlanner(text);
              setMessage(res.ok ? { tone: "ok", text: res.message ?? "Asked." } : { tone: "error", text: res.error });
              if (res.ok) setText("");
              router.refresh();
            })
          }
          className="rounded border border-ink px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          Ask the Launch Planner
        </button>
        <Status message={message} />
      </div>
    </div>
  );
}
