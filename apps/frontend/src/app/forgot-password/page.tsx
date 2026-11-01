import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPassword } from "@/components/auth/forgot-password";

export const metadata: Metadata = { title: "Reset your password · LinkRoom" };

// Asks for a reset link, or (opened from the emailed link, ?token_hash=…) takes the new password.
export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <ForgotPassword />
    </Suspense>
  );
}
