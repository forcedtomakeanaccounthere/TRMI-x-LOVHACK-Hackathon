"use client";

import {
  CheckCircleIcon,
  CloudArrowUpIcon,
  LinkSimpleIcon,
  SparkleIcon,
  TextAlignLeftIcon,
  WarningCircleIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react";
import type { FileFormat } from "@linkroom/shared";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { getFreshSession, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Spinner } from "./bits";
import { youtubeId, youtubeTitle } from "./docs";
import { driveConfigured, pickFromDrive } from "./drive";
import { useRoom } from "./store";

const TABS = [
  { id: "upload", label: "Upload", icon: CloudArrowUpIcon },
  { id: "link", label: "Link", icon: LinkSimpleIcon },
  { id: "youtube", label: "YouTube", icon: YoutubeLogoIcon },
  { id: "text", label: "Paste text", icon: TextAlignLeftIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];

const ACCEPT = ".pdf,.docx,.pptx,.ppt,.doc,.md,.markdown,.txt";
const MAX_BYTES = 20 * 1024 * 1024;
const SITES = ["Wikipedia", "Notion", "Medium", "Substack", "arXiv", "Blogs", "Web docs"];

const formatOf = (name: string): FileFormat | null => {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "markdown") return "md";
  return (["pdf", "docx", "pptx", "ppt", "md", "txt"] as const).find((f) => f === ext) ?? null;
};

async function token() {
  const session = await getFreshSession();
  if (!session) throw new Error("Sign in to add sources");
  return session.access_token;
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

// NotebookLM-style "add sources": files from the device or Google Drive, web links, YouTube videos and
// pasted text. Each one becomes a backend room (extraction, indexing and highlights work as usual)
// and is attached to this room.
export function AddSourceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const session = useSession();
  const [tab, setTab] = useState<TabId>("upload");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-[2rem] border-0 bg-[color-mix(in_oklab,var(--background)_88%,transparent)] p-0 backdrop-blur-2xl sm:max-w-2xl">
        <div className="relative px-7 pt-7">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(47_91_255/0.22),transparent)]"
            aria-hidden
          />
          <DialogTitle className="relative text-center font-display text-[2.1rem] leading-none font-normal">
            Add sources to <span className="italic">the room</span>
          </DialogTitle>
          <DialogDescription className="relative mt-2 text-center text-[0.8125rem]">
            PDF, Word, PowerPoint, Markdown and text · web pages · YouTube
          </DialogDescription>

          <div className="relative mx-auto mt-6 flex w-max gap-1 rounded-full bg-foreground/5 p-1" role="tablist">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "relative flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-medium transition-colors",
                  tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === id && (
                  <motion.span
                    layoutId="source-tab"
                    className="absolute inset-0 rounded-full bg-card shadow-sm ring-1 ring-(--hairline)"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
                  />
                )}
                <Icon
                  weight={tab === id ? "fill" : "regular"}
                  className={cn("relative size-4", id === "youtube" && tab === id && "text-red-500")}
                />
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="px-7 pt-5 pb-7">
          {!session ? (
            <div className="rounded-3xl border border-dashed border-(--hairline) p-10 text-center">
              <p className="text-[0.875rem]">Adding sources needs an account, so the room knows who added what.</p>
              <Link
                href={`/login?next=${encodeURIComponent(typeof window === "undefined" ? "/" : location.pathname)}`}
                className="mt-4 inline-flex h-10 items-center rounded-full bg-ink px-5 text-[0.8125rem] font-medium text-pearl dark:bg-azure"
              >
                Sign in
              </Link>
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22 }}
              >
                {tab === "upload" && <UploadTab onDone={() => onOpenChange(false)} />}
                {tab === "link" && <LinkTab onDone={() => onOpenChange(false)} />}
                {tab === "youtube" && <YoutubeTab onDone={() => onOpenChange(false)} />}
                {tab === "text" && <TextTab onDone={() => onOpenChange(false)} />}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Upload = {
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
};

function UploadTab({ onDone }: { onDone: () => void }) {
  const { actions } = useRoom();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [drive, setDrive] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploads((prev) => [...prev, ...files.map((f) => ({ name: f.name, status: "uploading" as const }))]);
    const set = (name: string, patch: Partial<Upload>) =>
      setUploads((prev) => prev.map((u) => (u.name === name ? { ...u, ...patch } : u)));
    let added = 0;
    await Promise.all(
      files.map(async (file) => {
        if (file.size > MAX_BYTES) return set(file.name, { status: "error", error: "Over 20 MB" });
        const ext = file.name.toLowerCase().split(".").pop();
        if (ext === "doc")
          return set(file.name, {
            status: "error",
            error: "Save it as .docx first, then upload that",
          });
        try {
          const { id } = await api.createFileRoom(file, await token());
          const format = formatOf(file.name);
          const isPdfRoom = format === "pdf" || format === "docx" || format === "pptx" || format === "ppt";
          actions.addDoc({
            id,
            kind: isPdfRoom ? "pdf" : "file",
            title: file.name,
            source_url: null,
            format,
          });
          set(file.name, { status: "done" });
          added++;
        } catch (err) {
          set(file.name, { status: "error", error: message(err) });
        }
      }),
    );
    if (added && added === files.length) {
      toast.success(added === 1 ? "Source added" : `${added} sources added`);
      setTimeout(onDone, 500);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload([...e.dataTransfer.files]);
        }}
        className={cn(
          "group flex w-full flex-col items-center rounded-3xl border-[1.5px] border-dashed px-6 py-10 transition-all",
          over
            ? "scale-[1.01] border-azure bg-azure/6"
            : "border-(--hairline) hover:border-azure/40 hover:bg-foreground/[0.02]",
        )}
      >
        <span className="grid size-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,#2f5bff,#8b5cf6)] text-white shadow-[0_18px_40px_-14px_rgb(47_91_255/0.8)] transition-transform group-hover:-translate-y-1">
          <CloudArrowUpIcon weight="fill" className="size-7" />
        </span>
        <span className="mt-4 text-[0.9375rem] font-medium">Drop files here, or browse</span>
        <span className="mt-1 text-[0.75rem] text-muted-foreground">
          PDF · DOCX · PPTX · PPT · MD · TXT, up to 20 MB each
        </span>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {["PDF", "DOCX", "PPTX", "PPT", "MD", "TXT"].map((f) => (
            <span
              key={f}
              className="rounded-md bg-foreground/5 px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground"
            >
              {f}
            </span>
          ))}
        </div>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => void upload([...(e.target.files ?? [])])}
      />

      <button
        type="button"
        disabled={drive}
        onClick={async () => {
          setDrive(true);
          try {
            await upload(await pickFromDrive());
          } catch (err) {
            toast.error(message(err));
          } finally {
            setDrive(false);
          }
        }}
        title={driveConfigured ? undefined : "Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_API_KEY"}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-card text-[0.8125rem] font-medium ring-1 ring-(--hairline) transition hover:ring-foreground/20 disabled:opacity-60"
      >
        <GoogleDriveLogo className="size-[18px]" />
        {drive ? "Bringing files from Drive…" : "Choose from Google Drive"}
        {drive && <Spinner />}
        {!driveConfigured && <span className="text-[0.6875rem] text-muted-foreground">(not set up)</span>}
      </button>

      {uploads.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {uploads.map((u) => (
            <li
              key={u.name}
              className="flex items-center gap-2.5 rounded-xl bg-foreground/[0.03] px-3 py-2 text-[0.8125rem]"
            >
              {u.status === "uploading" ? (
                <Spinner className="text-azure" />
              ) : u.status === "done" ? (
                <CheckCircleIcon weight="fill" className="size-4 text-emerald-500" />
              ) : (
                <WarningCircleIcon weight="fill" className="size-4 text-destructive" />
              )}
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span
                className={cn("text-[0.6875rem]", u.status === "error" ? "text-destructive" : "text-muted-foreground")}
              >
                {u.status === "uploading" ? "Reading…" : u.status === "done" ? "Added" : u.error}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkTab({ onDone }: { onDone: () => void }) {
  const { actions } = useRoom();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    let value = url.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    if (youtubeId(value)) {
      setError("That's a YouTube link. Use the YouTube tab to watch and process it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createLinkRoom({ url: value }, await token());
      actions.addDoc({
        id,
        kind: "link",
        title: new URL(value).hostname.replace(/^www\./, ""),
        source_url: value,
        format: null,
      });
      toast.success("Page added");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't read that page");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="liquid-glass flex items-center gap-2 rounded-2xl p-1.5 pl-4">
        <LinkSimpleIcon className="size-5 text-muted-foreground" />
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://en.wikipedia.org/wiki/…"
          inputMode="url"
          className="h-10 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-[0.8125rem] font-medium text-pearl disabled:opacity-50 dark:bg-azure"
        >
          {busy && <Spinner />} {busy ? "Reading…" : "Add"}
        </button>
      </div>
      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/8 px-3 py-2 text-[0.8125rem] text-destructive">
          <WarningCircleIcon weight="fill" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      <div className="mt-5 text-[0.6875rem] text-muted-foreground">Works well with</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SITES.map((s) => (
          <span key={s} className="rounded-full bg-foreground/5 px-2.5 py-1 text-[0.75rem]">
            {s}
          </span>
        ))}
      </div>
      <p className="mt-4 text-[0.6875rem] leading-relaxed text-muted-foreground">
        Pages that need a login (private Notion, Google Docs) can&apos;t be read from a link: export them as PDF or DOCX
        and upload instead.
      </p>
    </form>
  );
}

function YoutubeTab({ onDone }: { onDone: () => void }) {
  const { actions } = useRoom();
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<{
    id: string;
    url: string;
    title: string;
  } | null>(null);
  const [busy, setBusy] = useState<"look" | "process" | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  const look = async () => {
    const id = youtubeId(url);
    if (!id) {
      toast.error("That isn't a YouTube link");
      return;
    }
    setBusy("look");
    const clean = `https://www.youtube.com/watch?v=${id}`;
    setVideo({
      id,
      url: clean,
      title: (await youtubeTitle(clean)) ?? "YouTube video",
    });
    setBusy(null);
  };

  const attach = () => {
    if (!video) return;
    actions.addDoc({
      id: `yt:${video.id}`,
      kind: "video",
      title: video.title,
      source_url: video.url,
      format: null,
    });
    onDone();
  };

  const process = async (transcript?: string) => {
    if (!video) return;
    setBusy("process");
    try {
      const { id } = await api.createYoutubeRoom(video.url, await token(), transcript);
      actions.addDoc({
        id,
        kind: "youtube",
        title: video.title,
        source_url: video.url,
        format: null,
      });
      toast.success("Transcript ready");
      setPasting(false);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && !transcript) setPasting(true);
      if (err instanceof ApiError && err.status === 404) {
        toast.message("Transcripts aren't on the backend yet, so the video is attached to watch.", {
          description: "POST /api/rooms/youtube",
        });
        attach();
      } else toast.error(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void look();
        }}
        className="liquid-glass flex items-center gap-2 rounded-2xl p-1.5 pl-4"
      >
        <YoutubeLogoIcon weight="fill" className="size-5 text-red-500" />
        <input
          autoFocus
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setVideo(null);
            setPasting(false);
            setPasted("");
          }}
          placeholder="https://youtube.com/watch?v=…"
          className="h-10 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none"
        />
        <button
          type="submit"
          disabled={!url.trim() || busy !== null}
          className="flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-[0.8125rem] font-medium text-pearl disabled:opacity-50 dark:bg-azure"
        >
          {busy === "look" && <Spinner />} Preview
        </button>
      </form>

      <AnimatePresence>
        {video && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bezel mt-4">
              <div className="bezel-core overflow-hidden">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0`}
                  title={video.title}
                  className="aspect-video w-full"
                  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              </div>
            </div>
            <div className="mt-3 truncate text-[0.875rem] font-medium">{video.title}</div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={attach}
                disabled={busy !== null}
                className="h-10 flex-1 rounded-full bg-card text-[0.8125rem] font-medium ring-1 ring-(--hairline) hover:ring-foreground/20"
              >
                Attach to watch
              </button>
              <button
                type="button"
                onClick={() => process()}
                disabled={busy !== null}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-[linear-gradient(120deg,#2f5bff,#8b5cf6)] text-[0.8125rem] font-semibold text-white shadow-[0_10px_24px_-10px_rgb(47_91_255/0.9)]"
              >
                {busy === "process" && <Spinner />} Process into document
              </button>
            </div>
            {pasting && (
              <div className="liquid-glass mt-3 space-y-3 rounded-2xl p-4">
                <div className="text-[0.8125rem] text-muted-foreground">
                  Paste the transcript instead. On YouTube: ⋯ under the video → Show transcript, then copy it.
                </div>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={5}
                  placeholder={"0:00\nFirst line…\n0:07\nNext line…"}
                  className="w-full resize-y rounded-xl border border-border bg-transparent p-3 text-[0.8125rem] outline-none focus:border-azure"
                />
                <button
                  type="button"
                  onClick={() => process(pasted)}
                  disabled={busy !== null || !pasted.trim()}
                  className="flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[0.8125rem] font-medium text-pearl active:scale-[0.98] disabled:opacity-60 dark:bg-azure"
                >
                  {busy === "process" ? <Spinner /> : <SparkleIcon weight="fill" className="size-4" />}
                  Use pasted transcript
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TextTab({ onDone }: { onDone: () => void }) {
  const { actions } = useRoom();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        try {
          const { id } = await api.createTextRoom({ title: title.trim() || undefined, text }, await token());
          actions.addDoc({
            id,
            kind: "link",
            title: title.trim() || "Pasted text",
            source_url: null,
            format: null,
          });
          toast.success("Text added");
          onDone();
        } catch (err) {
          toast.error(message(err));
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-3"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        placeholder="Title (optional)"
        className="h-11 w-full rounded-2xl bg-card px-4 text-[0.875rem] ring-1 ring-(--hairline) outline-none focus:ring-azure/50"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={200_000}
        rows={8}
        placeholder="Paste notes, an article or a transcript…"
        className="w-full resize-none rounded-2xl bg-card p-4 text-[0.875rem] leading-relaxed ring-1 ring-(--hairline) outline-none focus:ring-azure/50"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-[0.875rem] font-medium text-pearl disabled:opacity-50 dark:bg-azure"
      >
        {busy && <Spinner />} Add text
      </button>
    </form>
  );
}

// Google Drive's own logo (the six-colour triangle), not a monochrome stand-in.
function GoogleDriveLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} aria-hidden>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}
