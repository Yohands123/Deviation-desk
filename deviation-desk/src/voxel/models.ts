/**
 * Voxel models, built in code: equipment, trucks and workers. Original designs; nothing here
 * imitates an existing game's characters (docs/DESIGN.md).
 * Each model is in local voxel coordinates with its footprint starting at (0, 0, 0).
 */
import { CLOTHES, EQUIPMENT, HAIR, hashIndex, SKIN, TRUCK } from "./palette";
import type { Outfit, Voxel } from "./types";

/** Fill a box of voxels: x0..x1, y0..y1, z0..z1 inclusive. */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string): Voxel[] {
  const out: Voxel[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push({ x, y, z, color });
  return out;
}

/** Later voxels replace earlier ones at the same position. */
export function merge(...parts: Voxel[][]): Voxel[] {
  const at = new Map<string, Voxel>();
  for (const v of parts.flat()) at.set(`${v.x},${v.y},${v.z}`, v);
  return [...at.values()];
}

// ─── Equipment ───────────────────────────────────────────────────────

const filler = () =>
  merge(
    box(0, 0, 0, 3, 1, 2, EQUIPMENT.steel), // base cabinet
    box(1, 2, 0, 2, 3, 1, EQUIPMENT.white), // dosing head housing
    box(0, 2, 2, 3, 2, 2, EQUIPMENT.glass), // isolator window
    box(1, 4, 0, 1, 4, 0, EQUIPMENT.accent), // needle manifold
  );
const capper = () => merge(box(0, 0, 0, 2, 1, 2, EQUIPMENT.steel), box(1, 2, 1, 1, 3, 1, EQUIPMENT.steelDark), box(0, 4, 0, 2, 4, 2, EQUIPMENT.steelDark));
const incubator = () => merge(box(0, 0, 0, 2, 3, 1, EQUIPMENT.white), box(1, 1, 1, 1, 2, 1, EQUIPMENT.glass));
const microscope = () => merge(box(0, 0, 0, 1, 1, 1, EQUIPMENT.white), box(0, 2, 0, 0, 3, 0, EQUIPMENT.rubber), box(1, 3, 0, 1, 3, 1, EQUIPMENT.rubber));
const coldStore = () => merge(box(0, 0, 0, 4, 3, 2, EQUIPMENT.white), box(1, 0, 2, 3, 3, 2, EQUIPMENT.glass), box(4, 1, 2, 4, 2, 2, EQUIPMENT.accent));
const generic = () => box(0, 0, 0, 1, 1, 1, EQUIPMENT.steel);

const EQUIPMENT_MODELS: Record<string, () => Voxel[]> = { filler, capper, incubator, microscope, cold_store: coldStore };

export function equipmentModel(type: string): Voxel[] {
  return (EQUIPMENT_MODELS[type] ?? generic)();
}

/** Width (x) and depth (z) of a model's footprint. */
export function footprint(model: Voxel[]): { w: number; d: number; h: number } {
  const max = (k: "x" | "y" | "z") => Math.max(...model.map((v) => v[k])) + 1;
  return { w: max("x"), d: max("z"), h: max("y") };
}

// ─── Trucks ──────────────────────────────────────────────────────────

export function truckModel(): Voxel[] {
  return merge(
    box(0, 1, 0, 5, 3, 2, TRUCK.body), // refrigerated box
    box(6, 1, 0, 7, 2, 2, TRUCK.cab),
    box(7, 2, 0, 7, 2, 2, TRUCK.window),
    box(1, 0, 0, 1, 0, 0, TRUCK.wheel),
    box(1, 0, 2, 1, 0, 2, TRUCK.wheel),
    box(6, 0, 0, 6, 0, 0, TRUCK.wheel),
    box(6, 0, 2, 6, 0, 2, TRUCK.wheel),
  );
}

// ─── Workers ─────────────────────────────────────────────────────────

/**
 * A worker 3 wide, 2 deep, 9 tall; the front faces +z. Outfits follow docs/DESIGN.md: cleanroom
 * gown and mask, lab coat, hard hat, hi-vis vest, office wear, suit, hard hat with blueprint, and
 * the Auditor's magnifier.
 */
export function workerModel(outfit: Outfit, id: string, carryingFolder = false): Voxel[] {
  const skin = SKIN[hashIndex(id, SKIN.length)] ?? SKIN[0] ?? "#e2b48f";
  const hair = HAIR[hashIndex(`${id}:hair`, HAIR.length)] ?? "#2a211c";
  const torso = { gown: CLOTHES.gown, labcoat: CLOTHES.coat, hardhat: CLOTHES.shirt, hivis: CLOTHES.hivis, office: CLOTHES.shirt, suit: CLOTHES.suit, blueprint: CLOTHES.shirt, auditor: CLOTHES.auditor }[outfit];
  const legs = outfit === "gown" ? CLOTHES.gown : outfit === "suit" ? CLOTHES.suit : CLOTHES.pants;

  const parts: Voxel[][] = [
    box(0, 0, 0, 0, 0, 1, CLOTHES.shoes),
    box(2, 0, 0, 2, 0, 1, CLOTHES.shoes),
    box(0, 1, 0, 0, 2, 1, legs),
    box(2, 1, 0, 2, 2, 1, legs),
    box(0, 3, 0, 2, 5, 1, torso),
    box(0, 6, 0, 2, 7, 1, skin), // head
    box(0, 8, 0, 2, 8, 1, hair),
  ];

  switch (outfit) {
    case "gown":
      parts.push(box(0, 8, 0, 2, 8, 1, CLOTHES.gown), box(0, 6, 1, 2, 6, 1, CLOTHES.mask), box(0, 7, 0, 2, 7, 0, CLOTHES.gown));
      break;
    case "labcoat":
      parts.push(box(0, 2, 0, 2, 2, 1, CLOTHES.coat)); // coat hangs below the waist
      break;
    case "hardhat":
    case "blueprint":
      parts.push(box(0, 8, 0, 2, 8, 1, CLOTHES.hardhat), box(0, 8, 2, 2, 8, 2, CLOTHES.hardhat));
      if (outfit === "blueprint") parts.push(box(3, 4, 0, 3, 4, 1, CLOTHES.blueprint));
      break;
    case "hivis":
      parts.push(box(0, 4, 0, 2, 4, 1, CLOTHES.reflect));
      break;
    case "suit":
      parts.push(box(1, 5, 1, 1, 5, 1, CLOTHES.collar));
      break;
    case "auditor":
      parts.push(box(3, 5, 1, 3, 5, 1, CLOTHES.brass), box(3, 6, 1, 3, 6, 1, EQUIPMENT.glass));
      break;
    case "office":
      break;
  }
  if (carryingFolder) parts.push(box(0, 4, 2, 2, 4, 2, CLOTHES.folder));
  return merge(...parts);
}

// ─── Saboteurs (drills only; original designs, docs/DESIGN.md §Saboteurs) ───

const SABOTEUR = {
  hunterBody: "#d9532b",
  hunterDark: "#8a2a12",
  visor: "#f3e9d2",
  violet: "#7b4fc9",
  violetDark: "#4b2c86",
  eye: "#f7f4ee",
  pupil: "#1c2128",
  teal: "#2aa198",
  tealDark: "#16615b",
  gold: "#e0b84a",
};

/** Hunter: squat red-orange block, stepped wedge nose, wide pale visor, spiked top. */
function hunter(): Voxel[] {
  return merge(
    box(0, 0, 0, 3, 2, 2, SABOTEUR.hunterBody),
    box(1, 0, 3, 2, 1, 3, SABOTEUR.hunterBody), // wedge nose, first step
    box(1, 0, 4, 2, 0, 4, SABOTEUR.hunterBody), // second step
    box(0, 2, 2, 3, 2, 2, SABOTEUR.visor),
    ...[0, 2].map((x) => box(x, 3, 1, x, 3, 1, SABOTEUR.hunterDark)),
    box(1, 3, 0, 1, 3, 0, SABOTEUR.hunterDark),
    box(3, 3, 0, 3, 3, 0, SABOTEUR.hunterDark),
  );
}

/** Ambusher: tall violet body with an eye on a periscope stalk. */
function ambusher(): Voxel[] {
  return merge(
    box(0, 0, 0, 1, 6, 1, SABOTEUR.violet),
    box(0, 0, 0, 1, 0, 1, SABOTEUR.violetDark),
    box(1, 7, 1, 1, 9, 1, SABOTEUR.violetDark),
    box(1, 10, 1, 2, 10, 2, SABOTEUR.eye),
    box(2, 10, 2, 2, 10, 2, SABOTEUR.pupil),
  );
}

/** Flanker: two teal cubes joined by a bar, each with a slit eye. */
function flanker(): Voxel[] {
  return merge(
    box(0, 0, 0, 1, 1, 1, SABOTEUR.teal),
    box(4, 0, 0, 5, 1, 1, SABOTEUR.teal),
    box(2, 1, 0, 3, 1, 0, SABOTEUR.tealDark),
    box(0, 1, 1, 1, 1, 1, SABOTEUR.pupil),
    box(4, 1, 1, 5, 1, 1, SABOTEUR.pupil),
  );
}

/** Wanderer: a loose cluster of gold cubes (drawn semi-transparent). */
function wanderer(): Voxel[] {
  const cells: Array<[number, number, number]> = [[0, 1, 0], [1, 2, 1], [2, 1, 0], [1, 0, 2], [0, 3, 1], [2, 3, 2], [3, 2, 1], [1, 4, 0]];
  return cells.map(([x, y, z]) => ({ x, y, z, color: SABOTEUR.gold }));
}

export function saboteurModel(name: "hunter" | "ambusher" | "flanker" | "wanderer"): Voxel[] {
  return { hunter, ambusher, flanker, wanderer }[name]();
}

/** Quarantine tape around a room's floor edge: alternating yellow and dark voxels, one high. */
export function tapeRing(w: number, d: number, yellow: string, dark: string): Voxel[] {
  const out: Voxel[] = [];
  const add = (x: number, z: number, i: number) => out.push({ x, y: 2, z, color: i % 2 === 0 ? yellow : dark });
  let i = 0;
  for (let x = 1; x < w - 1; x++) add(x, 1, i++);
  for (let z = 2; z < d - 1; z++) add(w - 2, z, i++);
  for (let x = w - 3; x >= 1; x--) add(x, d - 2, i++);
  for (let z = d - 3; z >= 2; z--) add(1, z, i++);
  return out;
}
