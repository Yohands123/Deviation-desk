/**
 * The flat map: the site as a floor plan, rooms tinted by status (docs/DESIGN.md §Voxel world,
 * flat-map fallback). Every tint is paired with a word and listed below for screen readers.
 */
import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { MapRoom, RoomTint } from "@/incident-room/types";

const SCALE = 40;
const TINT: Record<RoomTint, { fill: string; stroke: string; label: string; text: string }> = {
  critical: { fill: "var(--color-critical-fill)", stroke: "var(--color-critical)", label: "Affected", text: "var(--color-critical-text)" },
  at_risk: { fill: "var(--color-at-risk-fill)", stroke: "var(--color-at-risk)", label: "At risk", text: "var(--color-at-risk-text)" },
  clear: { fill: "var(--color-panel)", stroke: "var(--color-line)", label: "Clear", text: "var(--color-muted)" },
};
const ICON = { critical: AlertOctagon, at_risk: AlertTriangle, clear: CheckCircle2 };

export function FlatMap({ rooms }: { rooms: MapRoom[] }) {
  if (rooms.length === 0) return <p className="text-sm text-muted">No floor plan for this site yet.</p>;
  const width = Math.max(...rooms.map((r) => r.x + r.w)) * SCALE;
  const height = Math.max(...rooms.map((r) => r.y + r.d)) * SCALE;

  return (
    <figure>
      <svg viewBox={`-4 -4 ${width + 8} ${height + 8}`} className="h-auto w-full" role="img" aria-label="Site floor plan with room status">
        {rooms.map((r) => {
          const t = TINT[r.tint];
          return (
            <g key={r.id}>
              <title>{`${r.name}: ${t.label}${r.reasons.length ? ` (${r.reasons.join("; ")})` : ""}`}</title>
              <rect x={r.x * SCALE} y={r.y * SCALE} width={r.w * SCALE} height={r.d * SCALE} rx={4} fill={t.fill} stroke={t.stroke} strokeWidth={r.tint === "clear" ? 1 : 2} />
              <text x={r.x * SCALE + 10} y={r.y * SCALE + 22} fontSize={14} fontWeight={600} fill="var(--color-ink)">
                {r.name}
              </text>
              <text x={r.x * SCALE + 10} y={r.y * SCALE + 40} fontSize={11} fill="var(--color-muted)">
                {r.department}
              </text>
              <text x={r.x * SCALE + 10} y={(r.y + r.d) * SCALE - 12} fontSize={12} fontWeight={600} fill={t.text}>
                {t.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
        {(Object.keys(TINT) as RoomTint[]).map((tint) => {
          const Icon = ICON[tint];
          return (
            <span key={tint} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-3 rounded-sm border" style={{ background: TINT[tint].fill, borderColor: TINT[tint].stroke }} />
              <Icon aria-hidden className="size-3.5" style={{ color: TINT[tint].text }} />
              {TINT[tint].label}
            </span>
          );
        })}
      </figcaption>
      <ul className="sr-only">
        {rooms.map((r) => (
          <li key={r.id}>
            {r.name}: {TINT[r.tint].label}. {r.reasons.join(". ")}
          </li>
        ))}
      </ul>
    </figure>
  );
}
