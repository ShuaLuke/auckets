// Seeded PRNG for the simulator. Same seed → same stream, on every machine,
// forever. Never use Math.random() anywhere in src/lib/sim — determinism is
// a stated requirement (docs/GAE_SIMULATOR.md §4.7 invariant 6): the same
// scenario + seed must produce a byte-identical result.
//
// mulberry32 is a tiny, well-distributed 32-bit generator; plenty for
// drawing group sizes and prices. Not for anything cryptographic.

export type Rng = {
  // Uniform float in [0, 1).
  next(): number;
  // Uniform integer in [min, max] inclusive.
  int(min: number, max: number): number;
  // Index drawn proportionally to `weights` (non-negative, not all zero).
  weightedIndex(weights: ReadonlyArray<number>): number;
  // Standard normal via Box–Muller.
  normal(): number;
  // Fisher–Yates shuffle, returns a new array.
  shuffle<T>(items: ReadonlyArray<T>): T[];
};

export function createRng(seed: number): Rng {
  let a = (seed >>> 0) || 0x9e3779b9;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      if (max < min) throw new Error(`rng.int: max ${max} < min ${min}`);
      return min + Math.floor(next() * (max - min + 1));
    },
    weightedIndex(weights) {
      let total = 0;
      for (const w of weights) {
        if (w < 0 || Number.isNaN(w)) throw new Error("rng.weightedIndex: negative or NaN weight");
        total += w;
      }
      if (total <= 0) throw new Error("rng.weightedIndex: all weights are zero");
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i]!;
        if (r < 0) return i;
      }
      return weights.length - 1; // float tail
    },
    normal() {
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
      }
      return out;
    },
  };
}
