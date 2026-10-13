"use client";
/**
 * Keeps every seat's view current: listens for new rows on this incident over Supabase Realtime
 * (row-level security limits it to the viewer's company) and re-renders the server components.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { browserSupabase } from "@/lib/supabase/browser";

const TABLES = ["incident_events", "decision_records", "approvals", "evidence", "seats"] as const;

export function RealtimeRefresh({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = browserSupabase();
    // Several rows often land together; refresh once per burst.
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    let channel = supabase.channel(`incident:${incidentId}`);
    for (const table of TABLES) {
      const filter = table === "approvals" ? undefined : `incident_id=eq.${incidentId}`;
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, refresh);
    }
    channel.subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [incidentId, router]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={connected ? "Updates arrive as they happen" : "Reconnecting"}>
      <span aria-hidden className={`size-1.5 rounded-full ${connected ? "bg-ok" : "bg-line"}`} />
      {connected ? "Live updates on" : "Connecting…"}
    </span>
  );
}
