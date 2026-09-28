// What each allocation policy actually does, in the words a venue manager,
// an artist's team, or Cope can follow — the "expand the option and see the
// detailed methodology" ask from the 2026-09-20 meeting. This is prose over
// the engine, not a second copy of it: every sentence describes a step in
// src/lib/gae or an opt-in field in AllocationConfig (src/lib/gae/types.ts),
// and the one-line caveats in policy.ts stay the report's voice.
//
// Policy names compose with "+" exactly as policy.ts parses them, so
// "clean-fit+singles-reserve" is the base method plus both parts, in order.

// What every policy does, before any part changes it. Numbered steps, each
// a plain sentence; the page renders them as a list.
export const BASE_METHOD: { title: string; steps: string[] } = {
  title: "What every policy starts from",
  steps: [
    "Rank the offers: price per ticket first, then a larger group ahead of a smaller one at the same price, then whoever offered first.",
    "Take the rows in the venue's rank order, best row first.",
    "For each row, walk down the ranked offers that asked for this tier (or said \"anywhere\"), and seat each one that fits in the seats still open — a group always sits together, in one row.",
    "If the next offer doesn't fit the seats left in the row, look further down the list for the next one that does, seat it, and leave the bigger group in the queue for the next row. Nobody is dropped for not fitting; they wait for a row that has room.",
    "Inside the row, place groups by the row's lean: from the middle out, toward the centre aisle, or from both aisles inward — best group first.",
    "When every row has been tried, offers that said \"this tier or worse\" (or \"or better\") get the same pass again over the tiers they'd accept. Offers that named one tier only are never moved.",
    "Whatever is left is unplaced: every seat it could have taken went to someone who offered more.",
  ],
};

export type PolicyPart = {
  key: string; // as written in a policy name: "clean-fit", "singles-reserve", "lookahead"
  label: string;
  summary: string; // one sentence for the picker
  steps: string[]; // what changes in the base method, in order
  tradeoff: string; // what it costs, in the open
  // Same meaning as policy.ts: true when rank is still the objective and any
  // pass-over is only to avoid a seat nobody could fill; false when the
  // policy holds fans back for fill's sake (lookahead, singles reserve).
  rankFirst: boolean;
};

export const POLICY_PARTS: Record<string, PolicyPart> = {
  greedy: {
    key: "greedy",
    label: "Greedy",
    summary: "The base method as shipped: strict rank order, no second-guessing.",
    steps: ["Nothing changes. This is the method above, exactly, and what production runs today."],
    tradeoff: "A row can end with one or two seats nobody in the queue fits — they stay empty. On Cope's Lincoln pool that is about 2% of the house.",
    rankFirst: true,
  },
  "clean-fit": {
    key: "clean-fit",
    label: "Clean-fit",
    summary: "Before seating a group that fits, check whether it would leave a hole nobody later can fill; if so, take the next group that closes the row instead.",
    steps: [
      "At step 3, before seating a group that fits, count the seats it would leave open in the row.",
      "If no offer further down the queue could fill those seats, don't seat this group here: look for the next group whose size closes the row cleanly, and seat that one.",
      "The passed-over group keeps its place in the queue and takes the next row it fits in — usually one row back.",
    ],
    tradeoff: "Some fans sit a row or two behind a smaller group that offered slightly less — only ever to avoid a seat nobody could fill. The report counts every one of them under \"passed over\", with how many rows and how many dollars apart.",
    rankFirst: true,
  },
  lookahead: {
    key: "lookahead",
    label: "Lookahead",
    summary: "Plan this row and the next two together, so a group can be held back one row when that leaves fewer empty seats across the three.",
    steps: [
      "At step 3, look at this row and the next two as one problem.",
      "If holding back at most one fitting group from this row leaves fewer empty seats across the three rows, hold it back.",
      "The held-back group must be seated within those rows — it is never dropped, and never pushed further than the window.",
    ],
    tradeoff: "This is Cope's Phase 6 framing: fill first, then rank. In practice it moves very few people, and on the Lincoln it recovers only a couple of seats.",
    rankFirst: false,
  },
  "parity-tiebreak": {
    key: "parity-tiebreak",
    label: "Parity tiebreak",
    summary: "When two offers are at the same price, prefer the one whose size matches the seats left in the row (odd to odd, even to even).",
    steps: [
      "At step 1, offers at the same price per ticket are normally ordered larger group first.",
      "With this on, when a row has an odd number of seats left, an odd-sized group at that price goes ahead of an even-sized one (and the other way round).",
      "Nothing crosses a price: a $60 offer never goes ahead of a $65 offer.",
    ],
    tradeoff: "None in rank terms — it only reorders ties. The gain is small and depends on the room: on the Lincoln, with the tech block modelled, it recovers four seats.",
    rankFirst: true,
  },
  "singles-reserve": {
    key: "singles-reserve",
    label: "Singles reserve",
    summary: "Hold back the lowest-ranked single-seat offers until everyone else is seated, then use them to fill single seats.",
    steps: [
      "Before step 2, set aside the lowest-ranked offers for one seat — as many as the venue has single-seat rows, unless the run says how many.",
      "Run the whole method without them.",
      "Then seat the reserved singles: single-seat rows first, then any one-seat gaps left in other rows.",
    ],
    tradeoff: "The reserved singles sit worse than their offer earned, on purpose, so that stray seats get filled. It is preventive, not rank-first, and kept as the smallest possible version of that idea.",
    rankFirst: false,
  },
  "protect-units": {
    key: "protect-units",
    label: "Protect tables and boxes",
    summary: "A table or box goes to one group only; the seats it doesn't use stay empty rather than going to strangers.",
    steps: [
      "At step 3, on a row that is a table or a box, seat one group and then close the unit — no second group joins it.",
      "Rows and GA pens are unaffected.",
    ],
    tradeoff: "Fill drops by the empty seats at each table. On the supper-club venue that is about 17 of 114 seats. This is the \"protect\" side of the open protect-vs-co-seat question (NEW-14).",
    rankFirst: true,
  },
};

export type Methodology = {
  name: string;
  parts: PolicyPart[];
  rankFirst: boolean;
};

// "clean-fit+singles-reserve" → the parts in order. Throws on a part the
// engine doesn't have, the same way policy.ts does.
export function methodologyFor(policyName: string): Methodology {
  const parts = policyName.split("+").map((raw) => {
    const key = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw; // lookahead:3, singles-reserve:5
    const part = POLICY_PARTS[key];
    if (!part) throw new Error(`no methodology for policy part "${raw}"`);
    return part;
  });
  return { name: policyName, parts, rankFirst: parts.every((p) => p.rankFirst) };
}
