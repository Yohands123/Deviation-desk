/**
 * Scene data for the voxel world (docs/DESIGN.md §Voxel world). Built on the server from the twin
 * and the incident, handed to the client as plain JSON. No three.js types here.
 */
import type { RoomTint } from "@/incident-room/types";

/** One cube. Integer grid coordinates; y is up. */
export interface Voxel {
  x: number;
  y: number;
  z: number;
  color: string;
}

export type Outfit = "gown" | "labcoat" | "hardhat" | "hivis" | "office" | "suit" | "blueprint" | "auditor";

export interface SceneRoom {
  id: string;
  name: string;
  department: string;
  roomType: string;
  /** Layout units (docs/DOMAIN.md seed); one unit is VOXELS_PER_UNIT voxels. */
  x: number;
  y: number;
  w: number;
  d: number;
  tint: RoomTint;
  reasons: string[];
  /** Quarantined or held material is in this room: show tape. */
  taped: boolean;
}

export interface SceneEquipment {
  id: string;
  name: string;
  type: string;
  roomId: string;
  status: string;
  /** Halted equipment or a halted line: show the amber light. */
  halted: boolean;
}

export interface SceneTruck {
  shipmentCode: string;
  status: string;
  held: boolean;
  destination: string;
}

export interface SceneWorker {
  id: string;
  kind: "agent" | "person";
  name: string;
  /** What they do, in plain words (agent job or seat). */
  role: string;
  outfit: Outfit;
  homeRoomId: string;
  targetRoomId: string;
  /** Their latest work is recent: walk from home to the target room. */
  walking: boolean;
  /** Holding a proposal that waits for a person. */
  carryingFolder: boolean;
  decisionRecordId: string | null;
}

export type SaboteurName = "hunter" | "ambusher" | "flanker" | "wanderer";

/** Drill only: a saboteur, where it last struck, and its current mode. */
export interface SceneSaboteur {
  name: SaboteurName;
  label: string;
  mode: "scatter" | "chase" | "frightened";
  /** Room of its latest target; null until it has acted. */
  roomId: string | null;
}

export interface SceneData {
  rooms: SceneRoom[];
  equipment: SceneEquipment[];
  trucks: SceneTruck[];
  workers: SceneWorker[];
  /** Rooms of the viewer's seat department; the camera frames them and dims the rest. */
  focusRoomIds: string[];
  /** Drills only. */
  saboteurs?: SceneSaboteur[];
}
