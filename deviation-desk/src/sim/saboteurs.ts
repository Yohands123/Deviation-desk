/**
 * Saboteur policies (CLAUDE.md §9). Deterministic: every choice comes from the drill's seeded PRNG,
 * so a drill replays exactly. Saboteurs never touch a live world (enforced where effects are applied).
 */
import type { EffectType, TargetTable } from "./effects";
import type { SaboteurMode, SaboteurName } from "./modes";
import type { Rng } from "./prng";

export interface Candidate {
  table: TargetTable;
  id: string;
  label: string;
}

export interface SaboteurContext {
  tick: number;
  /** 1 (gentle) to 5 (relentless). */
  difficulty: number;
  mode: SaboteurMode;
  /** The object the team is most focused on (most cited recently). */
  focus: Candidate | null;
  /** The room where the focus object lives, if any. */
  focusRoom: Candidate | null;
  /** Objects connected to the focus (shared lots, shared equipment), for a second front. */
  related: Candidate[];
  /** Shipments the team's current plan depends on (reroutes, staged shipments). */
  plannedShipments: Candidate[];
  /** Rooms with nothing going on, for false alarms. */
  quietRooms: Candidate[];
}

export interface PlannedEffect {
  actor: SaboteurName;
  type: EffectType;
  target: Candidate;
}

export function actChance(difficulty: number): number {
  return Math.min(0.75, 0.12 * Math.max(1, Math.min(5, difficulty)));
}

/** What the Hunter does to the focus: escalate it in place. Release tests are left to scenarios. */
function hunt(ctx: SaboteurContext): PlannedEffect | null {
  const f = ctx.focus;
  if (!f) return null;
  if (f.table === "equipment") return { actor: "hunter", type: "equipment_fault", target: f };
  if (f.table === "shipments") return { actor: "hunter", type: "temp_excursion", target: f };
  const room = f.table === "rooms" ? f : ctx.focusRoom;
  return room ? { actor: "hunter", type: "em_spike", target: room } : null;
}

export function planSaboteurs(ctx: SaboteurContext, rng: Rng): PlannedEffect[] {
  if (ctx.mode === "frightened") return [];
  const p = actChance(ctx.difficulty);
  const planned: PlannedEffect[] = [];

  // Draw for every saboteur every tick, in a fixed order, so one saboteur's choice never shifts
  // another's random numbers between replays.
  const rolls = { hunter: rng.next(), ambusher: rng.next(), flanker: rng.next(), wanderer: rng.next() };
  const picks = { ambusher: rng.next(), flanker: rng.next(), wanderer: rng.next() };
  const pick = <T>(items: T[], r: number): T | undefined => items[Math.floor(r * items.length)];

  if (ctx.mode === "chase") {
    if (rolls.hunter < p) {
      const e = hunt(ctx);
      if (e) planned.push(e);
    }
    const shipment = pick(ctx.plannedShipments, picks.ambusher);
    if (rolls.ambusher < p && shipment) planned.push({ actor: "ambusher", type: "shipment_delay", target: shipment });
    const second = pick(ctx.related, picks.flanker);
    if (rolls.flanker < p * 0.8 && second) {
      if (second.table === "equipment") planned.push({ actor: "flanker", type: "equipment_fault", target: second });
      else if (second.table === "rooms" || second.table === "batches") planned.push({ actor: "flanker", type: "em_spike", target: second });
    }
  }
  // The Wanderer wanders in both scatter and chase, more quietly when scattering.
  const quiet = pick(ctx.quietRooms, picks.wanderer);
  const wanderChance = ctx.mode === "scatter" ? p * 0.5 : p * 0.7;
  if (rolls.wanderer < wanderChance && quiet) planned.push({ actor: "wanderer", type: "false_alarm", target: quiet });

  // Never two effects on the same object in one tick.
  const seen = new Set<string>();
  return planned.filter((e) => {
    const key = `${e.target.table}:${e.target.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
