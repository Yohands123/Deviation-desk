/**
 * Voxel colours. Status colours match the live theme tokens (docs/DESIGN.md) and are used for
 * status only; everything else is neutral or describes clothing and equipment.
 */
import type { RoomTint } from "@/incident-room/types";

export const FLOOR: Record<RoomTint, string> = {
  clear: "#e9e6dd",
  at_risk: "#efd593",
  critical: "#f0b893",
};

export const STATUS = {
  critical: "#c2490d",
  atRisk: "#d08a0b",
  tapeYellow: "#e8c33a",
  tapeDark: "#1c2128",
};

export const BUILDING = {
  backWall: "#d6d1c4",
  backWallTrim: "#c4bdac",
  divider: "#cfc9ba",
  ground: "#f5f4ef",
};

export const EQUIPMENT = {
  steel: "#9aa3ad",
  steelDark: "#6f7883",
  white: "#f3f2ee",
  glass: "#a9c7dd",
  accent: "#2f5d8a",
  conveyor: "#4a4f57",
  rubber: "#2a2d33",
};

export const TRUCK = { body: "#eef0f2", cab: "#2f5d8a", wheel: "#22252a", window: "#a9c7dd" };

export const CLOTHES = {
  gown: "#f4f6f8",
  mask: "#7fa7c9",
  coat: "#fbfbf8",
  hardhat: "#e0b21b",
  hivis: "#ef7d22",
  reflect: "#f4e04d",
  shirt: "#5b7fa6",
  suit: "#2b3442",
  collar: "#f2f2f2",
  pants: "#3b414b",
  shoes: "#22252a",
  auditor: "#4a4e8a",
  blueprint: "#3f78b5",
  folder: "#d9b26f",
  brass: "#b08a3c",
};

/** A range of skin tones, picked per worker deterministically. */
export const SKIN = ["#f1d0b5", "#e2b48f", "#c68f68", "#a46d4b", "#7b4a32", "#5a3725"];
export const HAIR = ["#2a211c", "#4b3426", "#7a5a3a", "#1b1b1b", "#9a9488"];

/** Mix a colour toward the page ground to dim rooms outside the viewer's department. */
export function dim(hex: string, amount = 0.6): string {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  const [r, g, b] = parse(hex);
  const [gr, gg, gb] = parse(BUILDING.ground);
  return `#${[mix(r, gr), mix(g, gg), mix(b, gb)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Small stable hash so the same worker always looks the same. */
export function hashIndex(id: string, size: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % size;
}
