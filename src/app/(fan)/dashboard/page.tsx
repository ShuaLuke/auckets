import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// Server component — runs on every request, no caching. The middleware
// (src/middleware.ts) already guards this route; the redirect here is a
// belt-and-suspenders for the case where middleware is misconfigured.
export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "unknown";

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Signed in as <span className="font-medium">{email}</span>.
      </p>
      <p className="mt-6 text-sm text-neutral-500">
        Placeholder. Real fan/artist/admin views come in Weeks 4–6 per
        docs/ROADMAP.md.
      </p>
    </main>
  );
}
