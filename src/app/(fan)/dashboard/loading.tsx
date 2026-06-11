// Route-level loading state for /dashboard (UI-2 feel pack). The page is
// force-dynamic SSR, so without this every navigation was a blank white
// stall while the data loaded. Mirrors the page's layout: greeting block,
// a section label, then show rows.

import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonShowRow,
} from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
      aria-busy
    >
      <div className="mx-auto max-w-[960px] px-4 py-12 md:px-8">
        <div className="mb-7">
          <SkeletonPageHeader />
        </div>
        <Skeleton className="mb-3" style={{ height: 12, width: 120 }} />
        <div className="flex flex-col gap-3">
          <SkeletonShowRow />
          <SkeletonShowRow />
          <SkeletonShowRow />
        </div>
      </div>
    </main>
  );
}
