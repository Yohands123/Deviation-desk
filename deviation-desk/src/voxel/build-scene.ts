/**
 * Turns scene data into positioned voxels: an isometric cutaway with back walls only, low dividers
 * between rooms and an open front (docs/DESIGN.md §Voxel world). Pure and deterministic; the
 * renderer draws the result as one instanced mesh.
 */
import { equipmentModel, footprint, merge, tapeRing, truckModel } from "./models";
import { BUILDING, dim, EQUIPMENT, FLOOR, STATUS } from "./palette";
import type { SceneData, SceneRoom, SceneWorker, Voxel } from "./types";

export const VOXELS_PER_UNIT = 4;
/** World units per voxel. */
export const VOXEL_SIZE = 0.25;
const BACK_WALL_HEIGHT = 9;
const MAX_TRUCKS = 3;

export type Owner = { kind: "room" | "equipment" | "truck"; id: string };

export interface PlacedVoxel extends Voxel {
  owner: Owner | null;
}

export interface RoomBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Anchor {
  x: number;
  y: number;
  z: number;
}

export interface StaticScene {
  voxels: PlacedVoxel[];
  bounds: RoomBounds;
  rooms: Record<string, RoomBounds>;
  /** Top centre of each piece of equipment (for the halted light). */
  equipmentTops: Record<string, Anchor>;
  /** Top centre of each truck (for status pins). */
  truckTops: Record<string, Anchor>;
}

export const roomBounds = (r: SceneRoom): RoomBounds => ({
  x0: r.x * VOXELS_PER_UNIT,
  z0: r.y * VOXELS_PER_UNIT,
  x1: (r.x + r.w) * VOXELS_PER_UNIT - 1,
  z1: (r.y + r.d) * VOXELS_PER_UNIT - 1,
});

/** Slightly lighter or darker variant of a colour, for the floor checker. */
function shade(hex: string, factor: number): string {
  const c = [1, 3, 5].map((i) => Math.min(255, Math.max(0, Math.round(parseInt(hex.slice(i, i + 2), 16) * factor))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function buildStaticScene(scene: SceneData): StaticScene {
  const out: PlacedVoxel[] = [];
  const rooms: Record<string, RoomBounds> = {};
  const equipmentTops: Record<string, Anchor> = {};
  const truckTops: Record<string, Anchor> = {};
  const focus = new Set(scene.focusRoomIds);
  const dimmed = (roomId: string, color: string) => (focus.size > 0 && !focus.has(roomId) ? dim(color) : color);
  const place = (voxels: Voxel[], dx: number, dz: number, owner: Owner | null, roomId: string | null, dy = 0) => {
    for (const v of voxels) out.push({ x: v.x + dx, y: v.y + dy, z: v.z + dz, color: roomId ? dimmed(roomId, v.color) : v.color, owner });
  };

  const all = scene.rooms.map((r) => [r, roomBounds(r)] as const);
  const bounds: RoomBounds = {
    x0: Math.min(...all.map(([, b]) => b.x0)),
    z0: Math.min(...all.map(([, b]) => b.z0)),
    x1: Math.max(...all.map(([, b]) => b.x1)),
    z1: Math.max(...all.map(([, b]) => b.z1)),
  };

  for (const [room, b] of all) {
    rooms[room.id] = b;
    const owner: Owner = { kind: "room", id: room.id };
    const floor = FLOOR[room.tint];

    // Floor, with a faint checker so the grid reads at a glance.
    const tiles: Voxel[] = [];
    for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) tiles.push({ x, y: 0, z, color: (x + z) % 2 === 0 ? floor : shade(floor, 0.97) });
    place(tiles, 0, 0, owner, room.id);

    // Back walls on the building's far sides only; the front stays open (cutaway).
    const walls: Voxel[] = [];
    const wallColor = (y: number) => (y === BACK_WALL_HEIGHT ? BUILDING.backWallTrim : BUILDING.backWall);
    if (b.z0 === bounds.z0) for (let x = b.x0 - 1; x <= b.x1; x++) for (let y = 0; y <= BACK_WALL_HEIGHT; y++) walls.push({ x, y, z: b.z0 - 1, color: wallColor(y) });
    if (b.x0 === bounds.x0) for (let z = b.z0; z <= b.z1; z++) for (let y = 0; y <= BACK_WALL_HEIGHT; y++) walls.push({ x: b.x0 - 1, y, z, color: wallColor(y) });
    place(walls, 0, 0, null, null);

    // Low dividers on edges shared with another room.
    const dividers: Voxel[] = [];
    if (b.x1 < bounds.x1) for (let z = b.z0; z <= b.z1; z++) dividers.push({ x: b.x1, y: 1, z, color: BUILDING.divider });
    if (b.z1 < bounds.z1) for (let x = b.x0; x <= b.x1; x++) dividers.push({ x, y: 1, z: b.z1, color: BUILDING.divider });
    place(dividers, 0, 0, owner, room.id);

    if (room.taped) {
      const w = b.x1 - b.x0 + 1;
      const d = b.z1 - b.z0 + 1;
      const posts = [
        [1, 1],
        [w - 2, 1],
        [1, d - 2],
        [w - 2, d - 2],
      ].flatMap(([px = 0, pz = 0]) => [1, 2].map((y) => ({ x: px, y, z: pz, color: STATUS.tapeDark })));
      place(merge(tapeRing(w, d, STATUS.tapeYellow, STATUS.tapeDark), posts), b.x0, b.z0, owner, room.id);
    }

    // Equipment in rows from the back of the room, joined by a conveyor in production rooms.
    const kit = scene.equipment.filter((e) => e.roomId === room.id);
    let cx = b.x0 + 2;
    let cz = b.z0 + 2;
    let rowDepth = 0;
    let previousEnd: number | null = null;
    for (const e of kit) {
      const model = equipmentModel(e.type);
      const fp = footprint(model);
      if (cx + fp.w > b.x1 - 1) {
        cx = b.x0 + 2;
        cz += rowDepth + 3;
        rowDepth = 0;
        previousEnd = null;
      }
      if (room.roomType === "cleanroom" && previousEnd !== null) {
        const belt: Voxel[] = [];
        for (let x = previousEnd + 1; x < cx; x++) belt.push({ x, y: 1, z: cz + 1, color: EQUIPMENT.conveyor });
        place(belt, 0, 0, { kind: "equipment", id: e.id }, room.id);
      }
      place(model, cx, cz, { kind: "equipment", id: e.id }, room.id, 1);
      equipmentTops[e.id] = { x: cx + fp.w / 2, y: fp.h + 1, z: cz + fp.d / 2 };
      previousEnd = cx + fp.w - 1;
      cx += fp.w + 2;
      rowDepth = Math.max(rowDepth, fp.d);
    }

    // Trucks wait at the shipping room.
    if (room.roomType === "shipping") {
      const truck = truckModel();
      const fp = footprint(truck);
      scene.trucks.slice(0, MAX_TRUCKS).forEach((t, i) => {
        const tx = b.x0 + 2;
        const tz = b.z0 + 2 + i * (fp.d + 2);
        place(truck, tx, tz, { kind: "truck", id: t.shipmentCode }, room.id, 1);
        truckTops[t.shipmentCode] = { x: tx + fp.w / 2, y: fp.h + 1, z: tz + fp.d / 2 };
      });
    }
  }

  return { voxels: out, bounds, rooms, equipmentTops, truckTops };
}

/** Where each worker stands: along the front of its room, so equipment rows stay clear. */
export function workerSpots(
  scene: Pick<SceneData, "rooms">,
  workers: SceneWorker[],
): Record<string, { home: { x: number; z: number }; target: { x: number; z: number } }> {
  const bounds = new Map(scene.rooms.map((r) => [r.id, roomBounds(r)]));
  const used = new Map<string, number>();
  const spot = (roomId: string) => {
    const b = bounds.get(roomId);
    if (!b) return { x: 0, z: 0 };
    const n = used.get(roomId) ?? 0;
    used.set(roomId, n + 1);
    const perRow = Math.max(1, Math.floor((b.x1 - b.x0 - 2) / 4));
    return { x: b.x0 + 2 + (n % perRow) * 4, z: b.z1 - 3 - Math.floor(n / perRow) * 3 };
  };
  const spots: Record<string, { home: { x: number; z: number }; target: { x: number; z: number } }> = {};
  for (const w of workers) {
    const target = spot(w.targetRoomId);
    // A worker already at work keeps one spot; only walkers need a separate starting point.
    spots[w.id] = { home: w.walking && w.homeRoomId !== w.targetRoomId ? spot(w.homeRoomId) : target, target };
  }
  return spots;
}
