"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addEvidence, requestRecheck } from "@/incident-room/actions";
import type { EvidenceItem } from "@/incident-room/types";
import { AiMarker, cx } from "../ui";
import { SourceLink } from "./source-drawer";

const OBJECT_TABLES = ["batches", "equipment", "rooms", "material_lots", "shipments", "orders"] as const;

export function EvidencePanel({ code, items }: { code: string; items: EvidenceItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [table, setTable] = useState<"" | (typeof OBJECT_TABLES)[number]>("");
  const [objectCode, setObjectCode] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "ok" | "warning"; text: string } | null>(null);

  const add = () =>
    start(async () => {
      const res = await addEvidence({ code, note, object: table && objectCode ? { table, code: objectCode } : undefined });
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      setNote("");
      setObjectCode("");
      setMessage({ tone: "ok", text: "Evidence added." });
      router.refresh();
    });

  const recheck = () =>
    start(async () => {
      const res = await requestRecheck(code);
      setMessage(res.ok ? { tone: res.warning ? "warning" : "ok", text: res.warning ?? "The agents are re-checking the evidence." } : { tone: "error", text: res.error });
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="text-sm text-muted">No evidence collected yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((e) => (
            <li key={e.id} className={cx("rounded p-2 text-sm", e.addedByType === "agent" ? "bg-ai-tint" : "border border-line")}>
              <div className="mb-0.5 text-xs">
                {e.addedByType === "agent" ? <AiMarker label={e.addedBy} /> : <span className="font-medium">{e.addedBy}</span>}
              </div>
              {e.sourceId ? (
                <SourceLink table={e.sourceTable} rowId={e.sourceId}>
                  {e.note}
                </SourceLink>
              ) : (
                <p>{e.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-line pt-3">
        <label htmlFor="evidence-note" className="block text-sm font-medium">
          Add evidence
        </label>
        <textarea
          id="evidence-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you see or check?"
          className="w-full rounded border border-line p-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <select value={table} onChange={(e) => setTable(e.target.value as typeof table)} className="rounded border border-line px-2 py-1 text-sm" aria-label="Linked object type">
            <option value="">No linked object</option>
            {OBJECT_TABLES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {table && (
            <input value={objectCode} onChange={(e) => setObjectCode(e.target.value)} placeholder="Code or name, e.g. A-2231" className="min-w-0 flex-1 rounded border border-line px-2 py-1 font-mono text-sm" aria-label="Linked object code" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={pending || note.trim().length < 3} onClick={add} className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-panel disabled:opacity-40">
            Add evidence
          </button>
          <button disabled={pending} onClick={recheck} className="rounded border border-line px-3 py-1.5 text-sm hover:border-ink disabled:opacity-40">
            Re-check with agents
          </button>
        </div>
        {message && (
          <p role="status" className={cx("text-sm", message.tone === "error" ? "text-critical-text" : message.tone === "warning" ? "text-at-risk-text" : "text-ok")}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
