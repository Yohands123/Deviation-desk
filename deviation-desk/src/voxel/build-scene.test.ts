import { describe, expect, it } from "vitest";
import { buildStaticScene, workerSpots } from "./build-scene";
import { equipmentModel, workerModel } from "./models";
import { dim, FLOOR } from "./palette";
import type { SceneData, SceneRoom, SceneWorker } from "./types";

const room = (over: Partial<SceneRoom>): SceneRoom => ({
  id: "r1",
  name: "Fill Room 3",
  department: "Manufacturing",
  roomType: "cleanroom",
  x: 0,
  y: 0,
  w: 2,
  d: 2,
  tint: "clear",
  reasons: [],
  taped: false,
  ...over,
});

const scene = (over: Partial<SceneData> = {}): SceneData => ({
  rooms: [room({}), room({ id: "r2", name: "Dock", roomType: "shipping", x: 2, tint: "critical" })],
  equipment: [],
  trucks: [],
  workers: [],
  focusRoomIds: [],
  ...over,
});

const floorOf = (s: ReturnType<typeof buildStaticScene>, id: string) => s.voxels.filter((v) => v.y === 0 && v.owner?.kind === "room" && v.owner.id === id);

describe("buildStaticScene", () => {
  it("lays one floor voxel per grid cell, tinted by status", () => {
    const s = buildStaticScene(scene());
    expect(floorOf(s, "r1")).toHaveLength(8 * 8);
    expect(floorOf(s, "r2").some((v) => v.color === FLOOR.critical)).toBe(true);
  });

  it("builds back walls only, leaving the front open", () => {
    const s = buildStaticScene(scene());
    const walls = s.voxels.filter((v) => v.owner === null);
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every((v) => v.z === -1 || v.x === -1)).toBe(true);
  });

  it("puts a low divider only on edges shared with another room", () => {
    const s = buildStaticScene(scene());
    const dividerR1 = s.voxels.filter((v) => v.y === 1 && v.owner?.kind === "room" && v.owner.id === "r1");
    const dividerR2 = s.voxels.filter((v) => v.y === 1 && v.owner?.kind === "room" && v.owner.id === "r2");
    expect(dividerR1.every((v) => v.x === 7)).toBe(true);
    expect(dividerR2).toEqual([]);
  });

  it("tapes rooms holding quarantined material", () => {
    const taped = buildStaticScene(scene({ rooms: [room({ taped: true })] }));
    expect(taped.voxels.filter((v) => v.y === 2).length).toBeGreaterThan(10);
  });

  it("places equipment with its top recorded, and trucks at the shipping room", () => {
    const s = buildStaticScene(
      scene({
        equipment: [{ id: "e1", name: "Filler 3", type: "filler", roomId: "r1", status: "running", halted: false }],
        trucks: [{ shipmentCode: "SH-118", status: "at_dock", held: true, destination: "Montreal DC" }],
      }),
    );
    expect(s.voxels.filter((v) => v.owner?.kind === "equipment").length).toBe(equipmentModel("filler").length);
    expect(s.equipmentTops.e1?.y).toBeGreaterThan(1);
    expect(s.truckTops["SH-118"]).toBeDefined();
  });

  it("dims rooms outside the focus", () => {
    const s = buildStaticScene(scene({ focusRoomIds: ["r2"] }));
    expect(floorOf(s, "r1")[0]?.color).toBe(dim(FLOOR.clear));
    expect(floorOf(s, "r2").some((v) => v.color === FLOOR.critical)).toBe(true);
  });
});

describe("workers", () => {
  const worker = (over: Partial<SceneWorker>): SceneWorker => ({
    id: "w1",
    kind: "agent",
    name: "Spread Tracker",
    role: "",
    outfit: "gown",
    homeRoomId: "r1",
    targetRoomId: "r2",
    walking: true,
    carryingFolder: false,
    decisionRecordId: null,
    ...over,
  });

  it("start walkers at home and give each worker its own spot", () => {
    const spots = workerSpots(scene(), [worker({}), worker({ id: "w2", walking: false })]);
    expect(spots.w1?.home.x).toBeLessThan(8); // inside r1
    expect(spots.w1?.target.x).toBeGreaterThanOrEqual(8); // inside r2
    expect(spots.w2?.home).toEqual(spots.w2?.target);
    expect(spots.w2?.target).not.toEqual(spots.w1?.target);
  });

  it("look the same every time, and carry a folder only when asked", () => {
    expect(workerModel("labcoat", "x")).toEqual(workerModel("labcoat", "x"));
    expect(workerModel("labcoat", "x", true).length).toBeGreaterThan(workerModel("labcoat", "x").length);
  });
});
