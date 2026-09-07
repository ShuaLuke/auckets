// Policy names → the opt-in AllocationConfig fields the engine understands
// (src/lib/gae/types.ts), plus the honest one-line caveat the report prints
// under each policy so a fill gain is never mistaken for a free lunch.

import type { AllocationConfig } from "@/lib/gae/types";

import { POLICY_PATTERN } from "./schema";
import type { SimVenue } from "./types";
import { activeRows, SimInputError } from "./venue";

export type ParsedPolicy = {
  name: string;
  config: Pick<AllocationConfig, "fitPolicy" | "parityTiebreak" | "singlesReserve">;
  rankFirst: boolean;
  caveat: string;
};

export const POLICY_HELP =
  'greedy · clean-fit · parity-tiebreak · singles-reserve[:k] · combine with "+", e.g. clean-fit+singles-reserve';

export function singleSeatRowCount(venue: SimVenue): number {
  return activeRows(venue).filter((r) => r.isGa !== true && r.capacity - r.holds.length === 1).length;
}

export function parsePolicy(name: string, venue: SimVenue): ParsedPolicy {
  if (!POLICY_PATTERN.test(name)) throw new SimInputError(`unknown policy "${name}". Policies: ${POLICY_HELP}`);
  const config: ParsedPolicy["config"] = {};
  const caveats: string[] = [];
  let rankFirst = true;
  for (const part of name.split("+")) {
    if (part === "greedy") {
      caveats.push("Shipped behaviour: strict rank order, FitResolver skips forward only on a non-fit. Rank-first.");
    } else if (part === "clean-fit") {
      config.fitPolicy = "clean_fit";
      caveats.push(
        "Clean-fit defers a group that FITS when placing it would strand seats no remaining offer can fill, and takes the next group that closes the row. Rank-respect is widened by those deferrals — they show up under \"passed over\".",
      );
    } else if (part === "parity-tiebreak") {
      config.parityTiebreak = true;
      caveats.push(
        "Parity tiebreak reorders offers at EQUAL price only (the spec's rank tie, normally larger group first) so odd groups meet odd remainders. Never crosses a price.",
      );
    } else if (part.startsWith("singles-reserve")) {
      const k = part.includes(":") ? Number(part.split(":")[1]) : singleSeatRowCount(venue);
      config.singlesReserve = k;
      rankFirst = false;
      caveats.push(
        `Singles reserve holds back the ${k} lowest-ranked single-seat offers until everyone else is seated, then puts them in 1-seat rows first. This is preventive hoarding — NOT rank-first — kept as the smallest guard for the parity hypothesis.`,
      );
    }
  }
  return { name, config, rankFirst, caveat: caveats.join(" ") };
}
