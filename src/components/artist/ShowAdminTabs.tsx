// Tabbed shell for the ShowAdmin page. Prototype-fidelity port of the
// tab bar in design/ui_kits/auckets/screens/ShowAdmin.jsx (lines
// 58-86) — 5 tabs with a hairline underline below the bar, the active
// tab marked by a 2px greenwood underline that sits flush against the
// hairline (mb -1 trick).
//
// Why a client component:
//   - Tab switching is purely local state (useState). All data is
//     already loaded by the server component above; tabs are just a
//     view toggle, not a data fetch.
//   - Only the active panel renders. Renders for the other 4 panels
//     are paid lazily on the first switch to each. The full data is
//     in props from the server, so the switch is instant — no
//     loading state needed.
//
// Why a single component holding all panels rather than one component
// per tab: the cards already exist as their own components; this file
// just wires the bar + the panel-switching. Keeps the diff small and
// the contract obvious. Same pattern the design uses inline.
//
// Fans · data tab content: per ADR-0017, this tab needs a privacy
// review before any per-fan rows can render. Showing the tab with a
// placeholder is more honest than hiding it — keeps the tab count
// matching the design, and tells the artist what's coming. The
// placeholder will be replaced once Julia clears the privacy review.

"use client";

import { useState } from "react";

import { BigStatsCard } from "@/components/artist/BigStatsCard";
import { DistributionCard } from "@/components/artist/DistributionCard";
import { HoldsCard } from "@/components/artist/HoldsCard";
import { ProvisionalPlacementCard } from "@/components/artist/ProvisionalPlacementCard";
import { RecentActivityCard } from "@/components/artist/RecentActivityCard";
import { TierBreakdownCard } from "@/components/artist/TierBreakdownCard";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { AddHoldRow } from "@/components/artist/AddHoldButton";
import type {
  ActivityEvent,
  ArtistShowSummaryView,
  HoldsView,
  PriceDistributionView,
  ProvisionalPlacementView,
  TierBreakdownView,
} from "@/lib/presenters";

type TabId = "overview" | "distribution" | "allocation" | "holds" | "fans";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "distribution", label: "Offer distribution" },
  { id: "allocation", label: "Provisional placement" },
  { id: "holds", label: "Holds & manifest" },
  { id: "fans", label: "Fans · data" },
];

type Props = {
  showId: string;
  show: ArtistShowSummaryView;
  activity: ActivityEvent[];
  tiers: TierBreakdownView;
  distribution: PriceDistributionView;
  placement: ProvisionalPlacementView;
  // When true, `placement` is a live in-memory projection (auto-run on
  // load, not a saved ops run) — caption it so the artist knows it
  // reflects the current pool, not a persisted allocation.
  placementIsLiveProjection: boolean;
  holds: HoldsView;
  activeHoldRows: AddHoldRow[];
};

export function ShowAdminTabs({
  showId,
  show,
  activity,
  tiers,
  distribution,
  placement,
  placementIsLiveProjection,
  holds,
  activeHoldRows,
}: Props) {
  const [active, setActive] = useState<TabId>("overview");

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Show admin sections"
        className="flex gap-1"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`showadmin-panel-${tab.id}`}
              id={`showadmin-tab-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className="cursor-pointer border-0 bg-transparent font-sans text-[13px] font-medium transition-colors"
              style={{
                // mb -1 puts the active border ON TOP of the parent
                // hairline so it visually replaces that segment.
                padding: "10px 12px",
                marginBottom: -1,
                color: isActive ? "var(--ink-900)" : "var(--ink-400)",
                borderBottom: `2px solid ${
                  isActive ? "var(--brand)" : "transparent"
                }`,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {active === "overview" && (
        <div
          id="showadmin-panel-overview"
          role="tabpanel"
          aria-labelledby="showadmin-tab-overview"
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <BigStatsCard show={show} />
            <RecentActivityCard events={activity} />
          </div>
          <TierBreakdownCard breakdown={tiers} />
        </div>
      )}

      {active === "distribution" && (
        <div
          id="showadmin-panel-distribution"
          role="tabpanel"
          aria-labelledby="showadmin-tab-distribution"
        >
          <DistributionCard distribution={distribution} />
        </div>
      )}

      {active === "allocation" && (
        <div
          id="showadmin-panel-allocation"
          role="tabpanel"
          aria-labelledby="showadmin-tab-allocation"
        >
          {placementIsLiveProjection && (
            <p
              className="mb-3 font-sans text-[11px]"
              style={{ color: "var(--fg-subtle)", lineHeight: 1.5 }}
            >
              Live projection of the current offer pool — updates as offers
              come in. Not a saved run; AUCKETS ops runs the binding
              allocation that locks placements.
            </p>
          )}
          <ProvisionalPlacementCard placement={placement} />
        </div>
      )}

      {active === "holds" && (
        <div
          id="showadmin-panel-holds"
          role="tabpanel"
          aria-labelledby="showadmin-tab-holds"
        >
          <HoldsCard
            holds={holds}
            showId={showId}
            activeRows={activeHoldRows}
          />
        </div>
      )}

      {active === "fans" && (
        <div
          id="showadmin-panel-fans"
          role="tabpanel"
          aria-labelledby="showadmin-tab-fans"
        >
          <Card className="p-6">
            <Eyebrow className="mb-3">Fans · data</Eyebrow>
            <p
              className="font-sans"
              style={{
                fontSize: 14,
                lineHeight: 1.55,
                color: "var(--ink-500)",
                maxWidth: 560,
              }}
            >
              Per-fan rows — email, phone, group size, offer, placement
              status, seats — plus CSV export and an &quot;Email all&quot;
              action. Gated on a privacy review (ADR-0017) for the
              server-only fields. Lands as its own slice once Julia
              clears what&apos;s safe to expose to the artist.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
