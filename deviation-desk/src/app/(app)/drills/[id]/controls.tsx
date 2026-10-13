"use client";
/** Facilitator controls: clock, difficulty, injections and reversals (AGENTS.md: inject_event). */
import { Pause, Play, SkipForward, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cx } from "@/components/ui";
import { endDrillAction, injectAction, pauseDrill, playDrill, reverseAction, setDifficultyAction, stepDrill } from "@/drills/actions";
import type { DrillConsole } from "@/drills/queries";

const EFFECT_NAMES: Record<string, string> = {
  em_spike: "EM spike",
  false_alarm: "False alarm",
  test_failure: "Test failure",
  equipment_fault: "Equipment fault",
  shipment_delay: "Shipment delay",
  temp_excursion: "Temperature excursion",
};

export function DrillControls({ drill }: { drill: DrillConsole }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [type, setType] = useState(drill.effectTypes[0]?.type ?? "em_spike");
  const tables = drill.effectTypes.find((e) => e.type === type)?.tables ?? [];
  const [table, setTable] = useState<string>(tables[0] ?? "rooms");
  const [code, setCode] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      setMessage(res.ok ? (done ? { tone: "ok", text: done } : null) : { tone: "error", text: res.error });
      router.refresh();
    });

  const running = drill.status === "running";
  const targets = drill.targets[table] ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {running ? (
          <button disabled={pending} onClick={() => act(() => pauseDrill(drill.id))} className="inline-flex items-center gap-1.5 rounded bg-ink px-3 py-1.5 text-sm font-medium text-panel disabled:opacity-40">
            <Pause aria-hidden className="size-4" /> Pause
          </button>
        ) : (
          <button disabled={pending} onClick={() => act(() => playDrill(drill.id))} className="inline-flex items-center gap-1.5 rounded bg-ink px-3 py-1.5 text-sm font-medium text-panel disabled:opacity-40">
            <Play aria-hidden className="size-4" /> Play ({drill.secondsPerTick}s per hour)
          </button>
        )}
        <button disabled={pending || running} onClick={() => act(() => stepDrill(drill.id, drill.tick))} className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm hover:border-ink disabled:opacity-40">
          <SkipForward aria-hidden className="size-4" /> Step one hour
        </button>
        {confirmEnd ? (
          <span className="inline-flex items-center gap-2 text-sm">
            End now and score it?
            <button disabled={pending} onClick={() => act(async () => { const r = await endDrillAction(drill.id); if (r.ok) router.push(`/drills/${drill.id}/debrief`); return r; })} className="rounded bg-critical px-3 py-1.5 font-medium text-ground">
              End the drill
            </button>
            <button onClick={() => setConfirmEnd(false)} className="text-muted hover:text-ink">
              Cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmEnd(true)} className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm hover:border-critical">
            <Square aria-hidden className="size-4" /> End drill
          </button>
        )}
      </div>

      <label className="block max-w-xs text-sm">
        <span className="font-medium">Difficulty: {drill.difficulty}</span>
        <input type="range" min={1} max={5} defaultValue={drill.difficulty} onChange={(e) => act(() => setDifficultyAction(drill.id, Number(e.target.value)))} className="mt-1 w-full" aria-label="Difficulty" />
      </label>

      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-sm font-medium">Inject an event</p>
        <div className="flex flex-wrap gap-2">
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value;
              setType(next);
              setTable(drill.effectTypes.find((x) => x.type === next)?.tables[0] ?? "rooms");
              setCode("");
            }}
            className="rounded border border-line bg-panel px-2 py-1 text-sm"
            aria-label="Event type"
          >
            {drill.effectTypes.map((e) => (
              <option key={e.type} value={e.type}>
                {EFFECT_NAMES[e.type] ?? e.type}
              </option>
            ))}
          </select>
          {tables.length > 1 && (
            <select value={table} onChange={(e) => { setTable(e.target.value); setCode(""); }} className="rounded border border-line bg-panel px-2 py-1 text-sm" aria-label="Target type">
              {tables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <select value={code} onChange={(e) => setCode(e.target.value)} className="rounded border border-line bg-panel px-2 py-1 text-sm" aria-label="Target">
            <option value="">Choose a target</option>
            {targets.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button disabled={pending || !code} onClick={() => act(() => injectAction({ drillRunId: drill.id, type, table, code }), "Injected.")} className="rounded border border-line px-3 py-1 text-sm hover:border-ink disabled:opacity-40">
            Inject
          </button>
        </div>
      </div>

      {drill.reversible.length > 0 && (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-sm font-medium">The saboteurs are frightened: undo their recent moves</p>
          <ul className="space-y-1">
            {drill.reversible.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="text-muted">Hour {e.tick} · {e.actor}:</span> {e.description}
                </span>
                <button disabled={pending} onClick={() => act(() => reverseAction(drill.id, e.id), "Reversed.")} className="rounded border border-line px-2 py-0.5 text-xs hover:border-ink">
                  Reverse
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {message && <p role="status" className={cx("text-sm", message.tone === "error" ? "text-critical-text" : "text-ok")}>{message.text}</p>}
    </div>
  );
}
