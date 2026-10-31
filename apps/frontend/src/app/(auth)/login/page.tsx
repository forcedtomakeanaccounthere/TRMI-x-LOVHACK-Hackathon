import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in · LinkRoom" };

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary to keep the shell prerendered.
    <Suspense fallback={<div className="h-[28rem]" />}>
      <LoginForm />
    </Suspense>
  );
}
