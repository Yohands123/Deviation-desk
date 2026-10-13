/**
 * What saboteurs, twists and facilitators can do to a drill world, described the way the team
 * will observe it. Writing the effects to the database lives in apply-effects.ts.
 */

export const EFFECT_TYPES = ["em_spike", "false_alarm", "test_failure", "equipment_fault", "shipment_delay", "temp_excursion"] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];
export type TargetTable = "rooms" | "batches" | "equipment" | "shipments";

/** Which objects each effect can land on. */
export const EFFECT_TARGETS: Record<EffectType, readonly TargetTable[]> = {
  em_spike: ["rooms", "batches"],
  false_alarm: ["rooms"],
  test_failure: ["batches"],
  equipment_fault: ["equipment"],
  shipment_delay: ["shipments"],
  temp_excursion: ["shipments"],
};

export const EFFECT_LABEL: Record<EffectType, string> = {
  em_spike: "Environmental monitoring spike",
  false_alarm: "Sensor alarm",
  test_failure: "Test failure",
  equipment_fault: "Equipment fault",
  shipment_delay: "Shipment delay",
  temp_excursion: "Temperature excursion",
};

/** Scenario files may use older names for the same effects. */
const ALIASES: Record<string, EffectType> = { em_positive: "em_spike", sterility_failure: "test_failure" };

export function normalizeEffectType(type: string): EffectType | null {
  if ((EFFECT_TYPES as readonly string[]).includes(type)) return type as EffectType;
  return ALIASES[type] ?? null;
}

/** The observable account the team sees; saboteur attribution is revealed only at the debrief. */
export function describeEffect(type: EffectType, label: string): string {
  switch (type) {
    case "em_spike":
      return `Environmental monitoring swab near ${label} came back at the action level.`;
    case "false_alarm":
      return `A sensor in ${label} raised an alarm.`;
    case "test_failure":
      return `QC reports a failed release test for ${label}.`;
    case "equipment_fault":
      return `${label} stopped with a fault.`;
    case "shipment_delay":
      return `The carrier reports ${label} will be about 12 hours late.`;
    case "temp_excursion":
      return `${label} logged temperatures above its storage range.`;
  }
}

/** What a reversal (recent effect undone while saboteurs are frightened) looks like to the team. */
export function describeReversal(type: EffectType, label: string): string {
  switch (type) {
    case "em_spike":
    case "false_alarm":
      return `Retest near ${label}: 0 CFU. The earlier reading was a sampling error.`;
    case "test_failure":
      return `Investigation found lab contamination; the retest of ${label} passed.`;
    case "equipment_fault":
      return `${label} was reset and is running again.`;
    case "shipment_delay":
      return `The carrier resolved the delay on ${label}.`;
    case "temp_excursion":
      return `The logger on ${label} was faulty; the product was verified in range.`;
  }
}
