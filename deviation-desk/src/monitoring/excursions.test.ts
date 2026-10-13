import { describe, expect, it } from "vitest";
import { findExcursions, type TempReading } from "./excursions";

const at = (h: number) => new Date(Date.UTC(2026, 9, 12, h));
const readings = (values: number[]): TempReading[] => values.map((value, i) => ({ id: String(i), value, recordedAt: at(i) }));

describe("findExcursions", () => {
  it("finds none when every reading is in range", () => {
    expect(findExcursions(readings([4, 5, 6, 7.9]), "refrigerated")).toEqual([]);
  });

  it("measures an excursion until the first reading back in range", () => {
    const [e, ...rest] = findExcursions(readings([5, 9, 11, 10, 6, 5]), "refrigerated");
    expect(rest).toEqual([]);
    expect(e?.durationHours).toBe(3); // 01:00 → 04:00
    expect(e?.peak).toBe(11);
    expect(e?.ongoing).toBe(false);
    expect(e?.readingIds).toEqual(["1", "2", "3"]);
  });

  it("reports an excursion still in progress at the last reading", () => {
    const [e] = findExcursions(readings([5, 9, 10]), "refrigerated");
    expect(e?.ongoing).toBe(true);
    expect(e?.durationHours).toBe(1);
  });

  it("finds cold excursions and keeps the reading furthest outside the range as the peak", () => {
    const [e] = findExcursions(readings([4, 1.5, 0.5, 1, 3]), "refrigerated");
    expect(e?.peak).toBe(0.5);
  });

  it("separates distinct excursions and ignores reading order", () => {
    const shuffled = readings([5, 9, 5, 9, 9, 5]).reverse();
    expect(findExcursions(shuffled, "refrigerated").map((e) => e.durationHours)).toEqual([1, 2]);
  });
});
