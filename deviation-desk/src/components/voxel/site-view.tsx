"use client";
/**
 * The site panel: the voxel world or the flat map. The 3D scene loads after the page's decision
 * panels (dynamic import), and the flat map takes over when WebGL is missing, the device is too
 * slow, or the person prefers it (docs/DESIGN.md §Voxel world, performance).
 */
import { Box, Map as MapIcon, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AgentCard as Card } from "@/incident-room/types";
import type { SceneData, SceneWorker } from "@/voxel/types";
import { AgentCard } from "../incident-room/agent-card";
import { cx } from "../ui";

const VoxelWorld = dynamic(() => import("./voxel-world"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Loading the 3D view…</div>,
});

type Mode = "3d" | "flat";
const PREFERENCE_KEY = "deviation-desk:site-view";

// Browser facts read as external stores: the server renders "unknown" and the client fills in
// after hydration, without setting state in effects.
const noSubscription = () => () => {};

let webglSupport: boolean | undefined;
function hasWebGL(): boolean {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      webglSupport = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const PREFERENCE_EVENT = "deviation-desk:site-view-changed";
function subscribePreference(onChange: () => void) {
  window.addEventListener(PREFERENCE_EVENT, onChange);
  return () => window.removeEventListener(PREFERENCE_EVENT, onChange);
}

function readPreference(): Mode | null {
  try {
    const v = window.localStorage.getItem(PREFERENCE_KEY);
    return v === "3d" || v === "flat" ? v : null;
  } catch {
    return null;
  }
}

function savePreference(mode: Mode) {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, mode);
  } catch {
    // Storage can be unavailable (private windows); the choice just won't be remembered.
  }
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

export function SiteView({ scene, cards, flat, dark = false }: { scene: SceneData; cards: Card[]; flat: ReactNode; dark?: boolean }) {
  const webgl = useSyncExternalStore(noSubscription, hasWebGL, () => null);
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION_QUERY).matches, () => false);
  const preference = useSyncExternalStore(subscribePreference, readPreference, () => null);
  const [tooSlow, setTooSlow] = useState(false);
  const [focusDepartment, setFocusDepartment] = useState(scene.focusRoomIds.length > 0);
  const [selected, setSelected] = useState<{ kind: "worker"; worker: SceneWorker } | { kind: "room"; id: string } | null>(null);

  // Unknown until the browser answers; then WebGL, speed and the person's choice decide.
  const mode: Mode | null = webgl === null ? null : !webgl ? "flat" : (preference ?? "3d");
  const notice = webgl === false ? "This browser cannot show the 3D view, so the flat map is shown." : tooSlow && mode === "flat" ? "The 3D view was running slowly on this device, so the flat map is shown. You can switch back above." : null;

  // Render the 3D scene only while it is on screen.
  const frame = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true));
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]); // the frame exists only in the 3D view

  const choose = (next: Mode) => {
    if (next === "3d") setTooSlow(false);
    savePreference(next);
  };

  const cardById = useMemo(() => new Map(cards.map((c) => [c.decisionRecordId, c])), [cards]);
  const room = selected?.kind === "room" ? scene.rooms.find((r) => r.id === selected.id) : null;
  const roomEquipment = room ? scene.equipment.filter((e) => e.roomId === room.id) : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Site view" className="inline-flex rounded border border-line p-0.5 text-sm">
          {(
            [
              ["3d", "3D view", Box],
              ["flat", "Flat map", MapIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => choose(value)}
              className={cx("inline-flex items-center gap-1.5 rounded px-2.5 py-1", mode === value ? "bg-ink text-panel" : "text-muted hover:text-ink")}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        {mode === "3d" && scene.focusRoomIds.length > 0 && (
          <button onClick={() => setFocusDepartment(!focusDepartment)} className="text-sm text-accent hover:underline">
            {focusDepartment ? "Show the whole site" : "Focus on my department"}
          </button>
        )}
      </div>
      {notice && <p className="mb-2 text-sm text-at-risk-text">{notice}</p>}

      {mode === "flat" && flat}
      {mode === "3d" && (
        <div className="relative">
          <div ref={frame} className="h-[420px] overflow-hidden rounded-md border border-line sm:h-[480px]">
            <VoxelWorld
              scene={scene}
              focusDepartment={focusDepartment}
              reducedMotion={reducedMotion}
              paused={!onScreen}
              dark={dark}
              onSelectWorker={(worker) => setSelected({ kind: "worker", worker })}
              onSelectRoom={(id) => setSelected({ kind: "room", id })}
              onTooSlow={() => {
                setTooSlow(true);
                savePreference("flat");
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            ◆ marks AI agents. A folder means a proposal is waiting for a person. Click a worker or a room for details.
          </p>

          {selected && (
            <div className="absolute right-2 top-2 max-h-[400px] w-[min(360px,calc(100%-1rem))] overflow-y-auto rounded-lg border border-line bg-panel p-3 shadow-lg">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{selected.kind === "worker" ? selected.worker.name : room?.name}</p>
                <button onClick={() => setSelected(null)} aria-label="Close details" className="rounded p-0.5 text-muted hover:bg-ground">
                  <X className="size-4" />
                </button>
              </div>
              {selected.kind === "worker" &&
                (() => {
                  const card = selected.worker.decisionRecordId ? cardById.get(selected.worker.decisionRecordId) : undefined;
                  if (card) return <AgentCard card={card} />;
                  return <p className="text-sm text-muted">{selected.worker.role}</p>;
                })()}
              {room && (
                <div className="space-y-2 text-sm">
                  <p className="text-muted">{room.department}</p>
                  <p className={room.tint === "critical" ? "text-critical-text" : room.tint === "at_risk" ? "text-at-risk-text" : "text-muted"}>
                    {{ critical: "Affected", at_risk: "At risk", clear: "Clear" }[room.tint]}
                    {room.taped ? " · taped off" : ""}
                  </p>
                  {room.reasons.length > 0 && (
                    <ul className="list-disc pl-5">
                      {room.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {roomEquipment.length > 0 && (
                    <div>
                      <p className="text-xs text-muted">Equipment</p>
                      <ul>
                        {roomEquipment.map((e) => (
                          <li key={e.id}>
                            {e.name} <span className={e.halted ? "text-at-risk-text" : "text-muted"}>· {e.halted ? "halted" : e.status}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
