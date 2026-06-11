// Route-level loading state for the ticket viewer (UI-2 feel pack).
// Mirrors TicketViewer's shell: dark room, a narrow centered column, the
// back link, then the tall paper ticket stub.

import { Skeleton } from "@/components/ui/Skeleton";

export default function TicketLoading() {
  return (
    <main
      style={{
        background: "var(--ink-900)",
        minHeight: "calc(100vh - 57px)",
      }}
      aria-busy
    >
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px 64px" }}>
        <Skeleton
          className="mb-6"
          style={{ height: 13, width: 110, backgroundColor: "var(--ink-700)" }}
        />
        {/* The stub itself loads as a paper block — the same surface the
            real ticket renders on, so the swap-in doesn't flash. */}
        <Skeleton
          style={{ height: 540, borderRadius: 14, backgroundColor: "var(--paper-2)" }}
        />
      </div>
    </main>
  );
}
