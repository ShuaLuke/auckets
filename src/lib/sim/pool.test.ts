/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { offerParitySummary, offersFromCsv, parseTierPref, toCents } from "./pool";

describe("offersFromCsv", () => {
  it("reads Cope's pool sheet layout and ranks by timestamp order", () => {
    const csv = "OfferRank,OfferID,PricePerTicket,GroupSize,RankKey,OfferParity,TimestampOrder\n1,30,500,5,500005,Odd,30\n2,4,500,4,500004,Even,4\n";
    const offers = offersFromCsv(csv);
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ id: "30", groupSize: 5, pricePerTicketCents: 50000, rankKey: 50000 * 1000 + 5 });
    expect(offers[0]!.submittedAt.getTime()).toBeGreaterThan(offers[1]!.submittedAt.getTime());
  });

  it("parses dollars, cents, tier tokens and rejects duplicates", () => {
    const csv = 'size,price,tier\n2,"$1,234.50",premium-\n1,50,mid+\n3,49.99,any\n';
    const offers = offersFromCsv(csv);
    expect(offers.map((o) => o.pricePerTicketCents)).toEqual([123450, 5000, 4999]);
    expect(offers[0]!.tierPreference).toEqual({ type: "this_or_worse", tier: "premium" });
    expect(offers[1]!.tierPreference).toEqual({ type: "this_or_better", tier: "mid" });
    expect(offers[2]!.tierPreference).toEqual({ type: "any" });
    expect(offersFromCsv("size,price\n2,5000\n", { priceMode: "cents" })[0]!.pricePerTicketCents).toBe(5000);
    expect(() => offersFromCsv("id,size,price\nx,2,10\nx,2,10\n")).toThrow(/duplicate offer id/);
    expect(() => offersFromCsv("foo,bar\n1,2\n")).toThrow(/group-size column/);
  });

  it("parseTierPref / toCents edge cases", () => {
    expect(parseTierPref("this_or_worse:gold")).toEqual({ type: "this_or_worse", tier: "gold" });
    expect(parseTierPref(undefined)).toEqual({ type: "any" });
    expect(toCents("0.1", "dollars")).toBe(10);
    expect(() => toCents("abc", "dollars")).toThrow(/bad price/);
  });
});

describe("offerParitySummary", () => {
  it("splits even/odd pressure and shares", () => {
    const offers = offersFromCsv("size,price\n2,10\n4,10\n3,10\n1,10\n");
    const s = offerParitySummary(offers, 20);
    expect(s).toMatchObject({ offers: 4, ticketsRequested: 10, demandMultiple: 0.5, evenOffers: 2, oddOffers: 2, evenTickets: 6, oddTickets: 4 });
    expect(s.byGroupSize[2]!.shareOfOffersPct).toBe(25);
    expect(s.byGroupSize[4]!.shareOfTicketsPct).toBe(40);
  });
});
