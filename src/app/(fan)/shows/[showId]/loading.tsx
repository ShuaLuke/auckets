// Route-level loading state for the fan show page (UI-2 feel pack).
// Mirrors the page's first paint: back link, the big venue header with a
// badge column on the right, then the live-preview composer's footprint
// (the venue map block + the offer dial card).

import { Skeleton } from "@/components/ui/Skeleton";

export default function ShowLoading() {
  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
      aria-busy
    >
      <div className="mx-auto px-4 pb-16 pt-8 md:px-8" style={{ maxWidth: 900 }}>
        <Skeleton className="mb-6" style={{ height: 13, width: 110 }} />

        <div className="mb-9 flex items-end justify-between gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton style={{ height: 11, width: 160, maxWidth: "60%" }} />
            <Skeleton style={{ height: 52, width: 360, maxWidth: "90%" }} />
            <Skeleton style={{ height: 15, width: 220, maxWidth: "70%" }} />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton
              style={{ height: 24, width: 96, borderRadius: "var(--radius-pill)" }}
            />
            <Skeleton style={{ height: 12, width: 130 }} />
          </div>
        </div>

        {/* Venue map + composer footprint */}
        <Skeleton className="mb-5" style={{ height: 320, borderRadius: 12 }} />
        <Skeleton style={{ height: 180, borderRadius: 12 }} />
      </div>
    </main>
  );
}
