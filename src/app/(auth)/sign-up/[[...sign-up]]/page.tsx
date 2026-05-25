import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-[calc(100vh-57px)] items-center justify-center p-6">
      <SignUp />
    </main>
  );
}
