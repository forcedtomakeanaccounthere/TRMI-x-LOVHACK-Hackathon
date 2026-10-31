import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create account · LinkRoom" };

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="h-[32rem]" />}>
      <SignupForm />
    </Suspense>
  );
}
