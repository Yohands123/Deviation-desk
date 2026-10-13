"use client";
/**
 * One-click sources (trust rule 2): every source chip opens the original record in a side drawer.
 */
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchSource } from "@/incident-room/actions";
import type { SourceRecord } from "@/incident-room/queries";

type Open = (table: string, rowId: string, note?: string) => void;
const SourceContext = createContext<Open>(() => {});

type DrawerState = { status: "closed" } | { status: "loading" | "error"; table: string; note?: string; error?: string } | { status: "ready"; record: SourceRecord; note?: string };

export function SourceDrawerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DrawerState>({ status: "closed" });

  const open = useCallback<Open>((table, rowId, note) => {
    setState({ status: "loading", table, note });
    void fetchSource(table, rowId).then((res) =>
      setState(res.ok ? { status: "ready", record: res.record, note } : { status: "error", table, note, error: res.error }),
    );
  }, []);

  useEffect(() => {
    if (state.status === "closed") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setState({ status: "closed" });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.status]);

  return (
    <SourceContext.Provider value={open}>
      {children}
      {state.status !== "closed" && (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={() => setState({ status: "closed" })}>
          <aside
            role="dialog"
            aria-label="Source record"
            className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Source record</p>
                <h2 className="font-mono text-sm">{state.status === "ready" ? state.record.table : state.table}</h2>
              </div>
              <button onClick={() => setState({ status: "closed" })} className="rounded p-1 text-muted hover:bg-ground" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            {state.note && <p className="mb-4 rounded bg-ai-tint p-3 text-sm">Cited for: {state.note}</p>}
            {state.status === "loading" && <p className="text-sm text-muted">Loading the record…</p>}
            {state.status === "error" && <p className="text-sm text-critical-text">{state.error}</p>}
            {state.status === "ready" && (
              <dl className="space-y-3 text-sm">
                {state.record.fields.map((f) => (
                  <div key={f.name}>
                    <dt className="text-xs capitalize text-muted">{f.name}</dt>
                    <dd className="whitespace-pre-wrap break-words">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </aside>
        </div>
      )}
    </SourceContext.Provider>
  );
}

const FIRST_CHIPS = 6;

export function SourceChips({ sources }: { sources: Array<{ table: string; rowId: string; note: string }> }) {
  const open = useContext(SourceContext);
  const [all, setAll] = useState(false);
  if (sources.length === 0) return <p className="text-xs text-muted">No sources cited.</p>;
  const shown = all ? sources : sources.slice(0, FIRST_CHIPS);
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Sources">
      {shown.map((s) => (
        <li key={`${s.table}:${s.rowId}`}>
          <button
            onClick={() => open(s.table, s.rowId, s.note)}
            title={s.note}
            className="max-w-56 truncate rounded border border-line bg-panel px-2 py-0.5 text-left text-xs hover:border-accent hover:text-accent"
          >
            <span className="text-muted">{s.table.replace(/_/g, " ")}:</span> {s.note}
          </button>
        </li>
      ))}
      {sources.length > FIRST_CHIPS && (
        <li>
          <button onClick={() => setAll(!all)} className="rounded px-2 py-0.5 text-xs text-accent hover:underline">
            {all ? "Show fewer" : `Show all ${sources.length} sources`}
          </button>
        </li>
      )}
    </ul>
  );
}

export function SourceLink({ table, rowId, children }: { table: string; rowId: string; children: ReactNode }) {
  const open = useContext(SourceContext);
  return (
    <button onClick={() => open(table, rowId)} className="text-left underline decoration-line underline-offset-2 hover:text-accent">
      {children}
    </button>
  );
}
