import { describe, expect, it } from "vitest";
import { createRng } from "./prng";

const take = (seed: number, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("createRng", () => {
  it("replays the same sequence for the same seed", () => {
    expect(take(42, 100)).toEqual(take(42, 100));
  });

  it("produces different sequences for different seeds", () => {
    expect(take(42, 10)).not.toEqual(take(43, 10));
  });

  it("stays within [0, 1)", () => {
    for (const v of take(7, 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() covers both bounds and nothing outside them", () => {
    const rng = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 1_000; i++) seen.add(rng.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it("pick() refuses an empty list", () => {
    expect(() => createRng(1).pick([])).toThrow();
  });
});
