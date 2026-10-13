/**
 * Saboteur modes (CLAUDE.md §9): scatter (quiet) → chase (active), repeating; frightened for a few
 * ticks after a team milestone, when the saboteurs hold off and their recent effects can be reversed.
 */

export const SABOTEURS = ["hunter", "ambusher", "flanker", "wanderer"] as const;
export type SaboteurName = (typeof SABOTEURS)[number];
export type SaboteurMode = "scatter" | "chase" | "frightened";

export const SCATTER_TICKS = 2;
export const CHASE_TICKS = 5;
export const FRIGHTENED_TICKS = 3;

/** Mode at a tick. Milestone ticks are when the team achieved something (a hold, an accepted cause). */
export function modeAt(tick: number, milestoneTicks: number[]): SaboteurMode {
  if (milestoneTicks.some((m) => tick > m && tick <= m + FRIGHTENED_TICKS)) return "frightened";
  return tick % (SCATTER_TICKS + CHASE_TICKS) < SCATTER_TICKS ? "scatter" : "chase";
}

export const SABOTEUR_INFO: Record<SaboteurName, { name: string; behaviour: string }> = {
  hunter: { name: "Hunter", behaviour: "Escalates the problem where the team is focused." },
  ambusher: { name: "Ambusher", behaviour: "Breaks the next step of the team's plan." },
  flanker: { name: "Flanker", behaviour: "Opens a related second front." },
  wanderer: { name: "Wanderer", behaviour: "Plants false alarms and red herrings." },
};
