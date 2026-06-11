// Route-level loading state for the public /shows index (UI-2 feel pack).
// Mirrors the page: title + sub line, then the lineup rows.

import { Skeleton, SkeletonShowRow } from "@/components/ui/Skeleton";

export default function ShowsIndexLoading() {
  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
      aria-busy
    >
      <div className="mx-auto max-w-[960px] px-4 py-10 md:px-8">
        <header className="mb-8 flex flex-col gap-3">
          <Skeleton style={{ height: 38, width: 180 }} />
          <Skeleton style={{ height: 14, width: 320, maxWidth: "80%" }} />
        </header>
        <div className="flex flex-col gap-3">
          <SkeletonShowRow />
          <SkeletonShowRow />
          <SkeletonShowRow />
        </div>
      </div>
    </main>
  );
}
