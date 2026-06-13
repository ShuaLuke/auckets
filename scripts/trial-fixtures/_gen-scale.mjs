// Generates 14_scale_oversubscribed.csv — ~200 offers into a 50-seat venue.
// Deterministic (no RNG) so the fixture is reproducible: group sizes cycle
// 1..8, prices descend with many ties, tier preferences cycle across the
// full spread so the waterfall and tie-breakers get exercised under load.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const N = 200;
const tiers = ["premium", "premium-", "mid", "mid+", "mid-", "ga", "ga-", "any", "any"];

const lines = ["id,groupSize,price,tier"];
for (let i = 1; i <= N; i++) {
  const groupSize = ((i - 1) % 8) + 1; // 1..8
  const price = 100 - Math.floor((i - 1) / 3); // descends; ~3 offers share each price
  const tier = tiers[(i - 1) % tiers.length];
  lines.push(`s${String(i).padStart(3, "0")},${groupSize},${price},${tier}`);
}
const out = join(here, "14_scale_oversubscribed.csv");
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out} (${N} offers)`);
