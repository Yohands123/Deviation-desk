/**
 * Who wears what and where they belong (docs/DESIGN.md §Voxel world): workers are dressed by role,
 * and each department or seat has a home room in the twin.
 */
import type { AgentConfig, SeatRole } from "@/agents/contract";
import type { Outfit } from "./types";

type Department = AgentConfig["department"];

export const AGENT_OUTFIT: Record<Department, Outfit> = {
  early_warning: "hardhat",
  triage: "office",
  investigation: "labcoat",
  containment: "gown",
  logistics: "hivis",
  regulatory: "office",
  council: "suit",
  communications: "office",
  expansion: "blueprint",
  drill: "office",
  oversight: "auditor",
};

export const SEAT_OUTFIT: Record<SeatRole, Outfit> = {
  qa_director: "labcoat",
  plant_manager: "hardhat",
  supply_chain_lead: "hivis",
  regulatory_affairs: "office",
  clinical_ops: "office",
  executive: "suit",
  strategy_growth: "blueprint",
  observer: "office",
  facilitator: "office",
};

/** How to find a room in the twin: by department name or by room type. */
export type RoomPreference = { department?: string; roomType?: string };

export const AGENT_HOME: Record<Department, RoomPreference> = {
  early_warning: { roomType: "lab" },
  triage: { department: "Quality Assurance" },
  investigation: { department: "Quality Assurance" },
  containment: { roomType: "storage" },
  logistics: { roomType: "shipping" },
  regulatory: { department: "Quality Assurance" },
  council: { department: "Quality Assurance" },
  communications: { department: "Quality Assurance" },
  expansion: { department: "Quality Assurance" },
  drill: { department: "Quality Assurance" },
  oversight: { department: "Quality Assurance" },
};

/** The department a seat looks after; null means the whole site (camera shows everything). */
export const SEAT_HOME: Record<SeatRole, RoomPreference | null> = {
  qa_director: { department: "Quality Assurance" },
  plant_manager: { department: "Manufacturing" },
  supply_chain_lead: { department: "Supply Chain" },
  regulatory_affairs: { department: "Quality Assurance" },
  clinical_ops: { roomType: "shipping" },
  executive: null,
  strategy_growth: null,
  observer: null,
  facilitator: null,
};

interface RoomLike {
  id: string;
  department: string;
  roomType: string;
}

export function roomsMatching(rooms: RoomLike[], pref: RoomPreference | null): string[] {
  if (!pref) return [];
  return rooms.filter((r) => (pref.department ? r.department === pref.department : true) && (pref.roomType ? r.roomType === pref.roomType : true)).map((r) => r.id);
}

export function firstRoom(rooms: RoomLike[], pref: RoomPreference | null): string | null {
  return roomsMatching(rooms, pref)[0] ?? rooms[0]?.id ?? null;
}
