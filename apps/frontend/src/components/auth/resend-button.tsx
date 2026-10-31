"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

const COOLDOWN_S = 30;

export function ResendButton({ email, className }: { email: string; className?: string }) {
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function resend() {
    setBusy(true);
    try {
      const { message } = await api.auth.resendVerification(email);
      toast.success(message);
      setWait(COOLDOWN_S);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend the email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={resend}
      disabled={busy || wait > 0 || !email}
      className={className ?? "font-medium text-azure underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"}
    >
      {busy ? "Sending…" : wait > 0 ? `Resend in ${wait}s` : "Resend the email"}
    </button>
  );
}
