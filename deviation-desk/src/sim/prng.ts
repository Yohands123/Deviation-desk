/**
 * Seeded PRNG for all simulation randomness (mulberry32). Never use Math.random() in src/sim.
 * Same seed → same drill, so runs can be replayed and compared.
 */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error("pick() on empty list");
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}
export type Rng = ReturnType<typeof createRng>;
