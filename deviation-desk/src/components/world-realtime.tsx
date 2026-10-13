"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { browserSupabase } from "@/lib/supabase/browser";

/** Re-renders when an agent writes a decision record in this world (pages outside incidents). */
export function WorldRealtime({ worldId }: { worldId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = browserSupabase();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    const channel = supabase
      .channel(`world:${worldId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "decision_records", filter: `world_id=eq.${worldId}` }, refresh)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [worldId, router]);
  return null;
}
