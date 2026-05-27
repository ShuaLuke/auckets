// "Live preview" banner on the fan Show detail right column. Mirrors
// design/ui_kits/auckets/screens/Show.jsx PreviewBanner (lines 187-218).
//
// Three render modes driven by the presenter's state:
//   - placed:       inverse Card with the marquee "Live preview" badge +
//                   "You'd land in Premium · Row A · seats 7–10"
//   - no-offer:     warm Card asking the fan to submit
//   - no-placement: warm Card explaining the preview hasn't run yet
//
// Server component — no client interactivity needed. Updates land on the
// next page render (server component is dynamic = "force-dynamic" on the
// parent page, so a hard refresh re-reads the latest provisional
// placement).

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { PreviewBannerView } from "@/lib/presenters";

type Props = {
  view: PreviewBannerView;
};

export function PreviewBanner({ view }: Props) {
  if (view.state === "no-offer") {
    return (
      <Card variant="warm" className="p-[18px]">
        <span
          className="font-sans"
          style={{ fontSize: 13, color: "var(--brick-700)" }}
        >
          Enter a price to see your live preview.
        </span>
      </Card>
    );
  }

  if (view.state === "no-placement") {
    return (
      <Card variant="warm" className="p-[18px]">
        <span
          className="font-sans"
          style={{ fontSize: 13, color: "var(--brick-700)" }}
        >
          Your offer is in the pool. The preview will light up here once
          allocation runs.
        </span>
      </Card>
    );
  }

  // Placed — render the inverse banner.
  return (
    <Card variant="inverse" className="p-5">
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-wrap items-baseline gap-4">
          <Badge tone="preview">Live preview</Badge>
          <span
            className="font-sans"
            style={{ fontSize: 15, color: "var(--paper)" }}
          >
            You&apos;d land in <strong>{view.tierLabel}</strong> · Row{" "}
            <span className="font-mono">{view.rowName}</span> · seats{" "}
            <span className="font-mono">{view.seatRange}</span>
          </span>
        </div>
        <span
          className="font-mono"
          style={{ fontSize: 11, color: "var(--ink-300)" }}
        >
          updates on refresh
        </span>
      </div>
    </Card>
  );
}
