"use client";
/** Small drill pieces shared by the console, the drill room and the debrief. */
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { SaboteurMode } from "@/sim/modes";
import { browserSupabase } from "@/lib/supabase/browser";

const MODE: Record<SaboteurMode, { label: string; style: { background: string; color: string } }> = {
  chase: { label: "Chase", style: { background: "#5a2e14", color: "#f4b680" } },
  scatter: { label: "Scatter", style: { background: "#16304a", color: "#9cc3ea" } },
  frightened: { label: "Frightened · reversible", style: { background: "#e8ecf1", color: "#1c2128" } },
};

/** Saboteur mode badge (docs/DESIGN.md §Saboteurs): colour always paired with the word. */
export function ModeBadge({ mode }: { mode: SaboteurMode }) {
  const m = MODE[mode];
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium" style={m.style}>
      {m.label}
    </span>
  );
}

/** Re-renders the drill screens when the drill's clock or visible events change. */
export function DrillRealtime({ drillRunId, worldId }: { drillRunId: string; worldId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = browserSupabase();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    const channel = supabase
      .channel(`drill:${drillRunId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "drill_runs", filter: `id=eq.${drillRunId}` }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sim_effects", filter: `world_id=eq.${worldId}` }, refresh)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [drillRunId, worldId, router]);
  return null;
}
