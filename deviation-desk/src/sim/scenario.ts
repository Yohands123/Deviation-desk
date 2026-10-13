/**
 * Scenario recipe schema (CLAUDE.md §9). The Scenario Builder must output this shape.
 * The hidden truth is stored separately (hidden_truths table) and never shown to response agents.
 */
import { z } from "zod";

const ObjectRef = z.object({ table: z.string(), code: z.string() }); // e.g. { table: "batches", code: "A-2231" }

export const Twist = z.object({
  atTick: z.number().int().nonnegative(),
  by: z.enum(["hunter", "ambusher", "flanker", "wanderer", "facilitator"]),
  description: z.string(),
  effect: z.object({ type: z.string(), target: ObjectRef, params: z.record(z.string(), z.unknown()).default({}) }),
});

export const Scenario = z.object({
  title: z.string(),
  description: z.string(), // plain language, shown to the facilitator
  level: z.number().int().min(1).max(5),
  durationTicks: z.number().int().positive(),
  trigger: z.object({
    type: z.string(),
    target: ObjectRef,
    atTick: z.number().int().nonnegative().default(0),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
  spread: z.object({
    mode: z.enum(["normal", "spreader"]),
    perTickProbability: z.number().min(0).max(1).default(0),
    edgeTypes: z.array(z.enum(["equipment", "material_lot", "shipment"])).default([]),
  }),
  twists: z.array(Twist).default([]),
  redHerrings: z.array(z.object({ description: z.string(), target: ObjectRef })).default([]),
  success: z.object({
    containWithinTicks: z.number().int().positive(),
    mustProtect: z.array(ObjectRef).default([]),
  }),
});
export type Scenario = z.infer<typeof Scenario>;

export const HiddenTruth = z.object({
  rootCause: z.string(),
  causeObject: ObjectRef,
  acceptableAnswers: z.array(z.string()).min(1), // phrasings the Auditor accepts as correct
});
export type HiddenTruth = z.infer<typeof HiddenTruth>;
