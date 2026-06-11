// Route-level loading state for /offers, the fan's offer history
// (UI-2 feel pack). Mirrors the page: header block, then history cards.

import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonShowRow,
} from "@/components/ui/Skeleton";

export default function OffersLoading() {
  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
      aria-busy
    >
      <div className="mx-auto max-w-[960px] px-4 py-12 md:px-8">
        <div className="mb-7 flex flex-col gap-3">
          <SkeletonPageHeader />
          <Skeleton style={{ height: 13, width: 180 }} />
        </div>
        <div className="flex flex-col gap-3">
          <SkeletonShowRow />
          <SkeletonShowRow />
          <SkeletonShowRow />
        </div>
      </div>
    </main>
  );
}
