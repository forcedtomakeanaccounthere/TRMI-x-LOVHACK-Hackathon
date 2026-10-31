"use client";

import { ArrowRightIcon, FilePdfIcon, LinkSimpleIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { getFreshSession, getSession, setSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const PENDING_LINK_KEY = "linkroom-pending-link";

// Paste a link → a room. Visitors without an account are sent to sign up, and the link waits for them.
// onCreated runs before the redirect, e.g. so the dashboard can remember the room's colour.
export function HeroLinkForm({ className, onCreated }: { className?: string; onCreated?: (id: string) => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // A link pasted before signing up waits here until the visitor comes back.
  // The input is uncontrolled, so restoring it is a DOM write, not a re-render.
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(PENDING_LINK_KEY);
      if (pending && getSession() && urlRef.current) {
        sessionStorage.removeItem(PENDING_LINK_KEY);
        urlRef.current.value = pending;
        urlRef.current.focus();
      }
    } catch {}
  }, []);

  function askToSignIn(url: string, expired: boolean) {
    try {
      if (url) sessionStorage.setItem(PENDING_LINK_KEY, url);
    } catch {}
    if (expired) {
      toast("Your session expired. Sign in again to open your room.");
      router.push("/login?next=/");
    } else {
      toast("Create a free account to open your room.");
      router.push("/signup?next=/");
    }
  }

  // Runs the room request with a fresh token; sends the visitor to sign in when there is none.
  async function createRoom(create: (token: string) => Promise<{ id: string }>, url = "") {
    const hadSession = getSession() !== null;
    setBusy(true);
    try {
      const session = await getFreshSession();
      if (!session) {
        setBusy(false);
        askToSignIn(url, hadSession);
        return;
      }
      const { id } = await create(session.access_token);
      onCreated?.(id);
      router.push(`/r/${id}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        askToSignIn(url, true);
        return;
      }
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = urlRef.current?.value.trim() ?? "";
    if (!url) return;
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    await createRoom((token) => api.createLinkRoom({ url: withScheme }, token), url);
  }

  async function onPdf(file: File | undefined) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("That PDF is over 20 MB.");
      return;
    }
    await createRoom((token) => api.createPdfRoom(file, token));
  }

  return (
    <div className={className}>
      <form
        onSubmit={onSubmit}
        className="liquid-glass group flex h-[3.75rem] items-center gap-2 rounded-full pr-1.5 pl-5 transition-shadow duration-500 ease-fluid focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--azure)_18%,transparent),var(--glass-shadow)]"
      >
        <LinkSimpleIcon weight="light" className="size-5 shrink-0 text-muted-foreground" />
        <label htmlFor="hero-url" className="sr-only">
          Paste any link
        </label>
        <input
          id="hero-url"
          ref={urlRef}
          name="url"
          placeholder="Paste any link — an article, the docs, a paper…"
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground/80"
        />
        <button
          type="submit"
          disabled={busy}
          className={cn(
            "group/btn inline-flex h-12 shrink-0 items-center gap-2.5 rounded-full bg-ink pr-1.5 pl-5 text-[0.875rem] font-medium text-pearl transition-transform duration-300 ease-fluid active:scale-[0.97] disabled:opacity-70 dark:bg-pearl dark:text-ink",
          )}
        >
          <span className="hidden sm:inline">{busy ? "Building your room…" : "Create room"}</span>
          <span className="sm:hidden">{busy ? "…" : "Create"}</span>
          <span className="grid size-9 place-items-center rounded-full bg-pearl/12 transition-transform duration-500 ease-fluid group-hover/btn:translate-x-0.5 dark:bg-ink/8">
            <ArrowRightIcon weight="light" className="size-4" />
          </span>
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 pl-5 text-[0.8125rem] text-muted-foreground">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          <FilePdfIcon weight="light" className="size-4" />
          or drop in a PDF (up to 20 MB)
        </button>
        <span className="hidden h-3 w-px bg-(--hairline) sm:block" />
        <span>No install. Guests don&apos;t need an account.</span>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => onPdf(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
