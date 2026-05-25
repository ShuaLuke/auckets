import { SignedIn, SignedOut, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-[calc(100vh-57px)] items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">AUCKETS</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Dynamic ticket allocation for live music. Coming soon.
        </p>
        <div className="mt-8 flex justify-center">
          <SignedOut>
            <SignUpButton mode="modal">
              <button className="rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700">
                Create an account
              </button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Go to dashboard
            </Link>
          </SignedIn>
        </div>
      </div>
    </main>
  );
}
