"use client";

import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  ImageIcon,
  NotebookIcon,
  PencilSimpleIcon,
  QuotesIcon,
  TextAlignLeftIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { downloadText, fileSafe } from "./ai";
import { Avatar, timeAgo } from "./bits";
import { useRoom } from "./store";
import type { NotebookEntry } from "./types";

// The room notebook: notes people leave for the room. Typed notes, passages saved from a source
// (Selection toolbar → Save to notebook; they link back to where they came from) and images. It
// lives in the room ledger like everything else, so everyone in the room sees the same notebook.

const MAX_TEXT = 4000;
const MAX_SIDE = 1280; // images are shrunk to fit this before they're added
const MAX_IMAGE_CHARS = 900_000; // about 650 KB once shrunk; bigger ones are refused

type Filter = "all" | NotebookEntry["kind"];
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text", label: "Notes" },
  { id: "quote", label: "Passages" },
  { id: "image", label: "Images" },
];

// Shrinks an image to a JPEG data URL small enough to share through the ledger.
async function shrinkImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_IMAGE_CHARS) return url;
  }
  throw new Error("That image is too large, even after shrinking it");
}

export function notebookToMarkdown(roomTitle: string, entries: NotebookEntry[], titleOf: (doc: string) => string) {
  const lines = [`# Notebook · ${roomTitle}`, ""];
  for (const e of [...entries].reverse()) {
    lines.push(`**${e.author.name}** · ${new Date(e.at).toLocaleString()}`);
    if (e.kind === "quote" && e.quote) lines.push(`> ${e.quote.text}`, `> — ${titleOf(e.quote.doc)}`);
    if (e.kind === "image") lines.push("*(image)*");
    if (e.text) lines.push(e.text);
    lines.push("");
  }
  return lines.join("\n");
}

export function NotebookDrawer() {
  const { notebookOpen, setNotebookOpen, state, primary } = useRoom();
  const [filter, setFilter] = useState<Filter>("all");
  const [zoomed, setZoomed] = useState<string | null>(null);
  const titleOf = (doc: string) => state.docs.find((d) => d.id === doc)?.title ?? "a source";

  useEffect(() => {
    if (!notebookOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !zoomed && setNotebookOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notebookOpen, zoomed, setNotebookOpen]);

  const entries = state.notebook;
  const shown = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  const count = (f: Filter) => (f === "all" ? entries.length : entries.filter((e) => e.kind === f).length);

  return (
    <>
      <AnimatePresence>
        {notebookOpen && (
          <>
            <motion.div
              key="scrim"
              className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNotebookOpen(false)}
            />
            <motion.aside
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Room notebook"
              className="liquid-glass liquid-glass-strong fixed inset-y-2 right-2 z-50 flex w-[min(30rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-[1.75rem]"
              initial={{ x: "105%" }}
              animate={{ x: 0 }}
              exit={{ x: "105%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.5 }}
            >
              <header className="flex items-start gap-3 border-b border-(--hairline) px-6 pt-5 pb-4">
                <div className="min-w-0 flex-1">
                  <div className="eyebrow text-[0.5625rem] text-azure">Room notebook</div>
                  <h2 className="mt-1.5 font-display text-[1.9rem] leading-none">
                    Notes left <span className="italic">here</span>
                  </h2>
                  <p className="mt-1.5 text-[0.75rem] text-muted-foreground">
                    Anything worth keeping: a thought, a passage, a picture. Everyone in the room sees it.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={entries.length === 0}
                  onClick={() =>
                    downloadText(
                      `${fileSafe(primary.title)} notebook.md`,
                      notebookToMarkdown(primary.title, entries, titleOf),
                    )
                  }
                  aria-label="Download the notebook as Markdown"
                  title="Download (.md)"
                  className="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/6 hover:text-foreground disabled:opacity-30"
                >
                  <DownloadSimpleIcon className="size-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setNotebookOpen(false)}
                  aria-label="Close notebook"
                  className="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/6 hover:text-foreground"
                >
                  <XIcon className="size-[18px]" />
                </button>
              </header>

              <Composer />

              <div className="flex gap-1 px-6 pt-3" role="tablist" aria-label="Show">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-full px-3 text-[0.75rem] font-medium transition",
                      filter === f.id
                        ? "bg-ink text-pearl dark:bg-pearl dark:text-ink"
                        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                    )}
                  >
                    {f.label}
                    <span className="text-[0.625rem] opacity-60 tabular-nums">{count(f.id)}</span>
                  </button>
                ))}
              </div>

              <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-3 pb-6">
                {shown.length === 0 ? (
                  <EmptyNotebook filtered={filter !== "all"} />
                ) : (
                  <ul className="space-y-3">
                    <AnimatePresence initial={false}>
                      {shown.map((e) => (
                        <EntryCard key={e.id} entry={e} titleOf={titleOf} onZoom={setZoomed} />
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <Dialog open={!!zoomed} onOpenChange={(o) => !o && setZoomed(null)}>
        <DialogContent className="w-auto max-w-[min(92vw,64rem)] rounded-[1.5rem] p-2 sm:max-w-[min(92vw,64rem)]">
          <DialogTitle className="sr-only">Image from the notebook</DialogTitle>
          <DialogDescription className="sr-only">Full size</DialogDescription>
          {zoomed && (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL from the notebook
            <img src={zoomed} alt="" className="max-h-[85dvh] w-auto rounded-[1.1rem]" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Composer() {
  const { actions, perms } = useRoom();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  if (!perms.annotate) {
    return (
      <p className="mx-6 mt-4 rounded-2xl bg-foreground/[0.04] px-4 py-3 text-[0.75rem] text-muted-foreground">
        You can read the notebook. Ask an admin for editor access to add notes.
      </p>
    );
  }

  const attach = async (blob: Blob) => {
    setBusy(true);
    try {
      setImage(await shrinkImage(blob));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that image");
    } finally {
      setBusy(false);
    }
  };

  const post = () => {
    const body = text.trim().slice(0, MAX_TEXT);
    if (!body && !image) return;
    const ok = actions.addToNotebook({ kind: image ? "image" : "text", text: body, quote: null, image });
    if (ok) {
      setText("");
      setImage(null);
    }
  };

  return (
    <div className="px-6 pt-4">
      <div
        className="rounded-2xl bg-card/80 ring-1 ring-(--hairline) transition focus-within:ring-azure/40"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const img = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
          if (img) {
            e.preventDefault();
            void attach(img);
          }
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              post();
            }
          }}
          onPaste={(e) => {
            const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (img) {
              e.preventDefault();
              void attach(img);
            }
          }}
          maxLength={MAX_TEXT}
          rows={3}
          placeholder={image ? "Add a caption (optional)…" : "Leave a note for the room…"}
          className="block w-full resize-none bg-transparent px-4 pt-3 text-[0.875rem] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        {image && (
          <div className="relative mx-3 mb-2 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
            <img src={image} alt="" className="max-h-36 rounded-xl ring-1 ring-(--hairline)" />
            <button
              type="button"
              onClick={() => setImage(null)}
              aria-label="Remove image"
              className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-ink text-pearl shadow dark:bg-pearl dark:text-ink"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-1 border-t border-(--hairline) px-2 py-1.5">
          <button
            type="button"
            onClick={() => file.current?.click()}
            disabled={busy}
            className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[0.75rem] text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
          >
            <ImageIcon className="size-4" /> {busy ? "Preparing…" : image ? "Change image" : "Image"}
          </button>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attach(f);
              e.target.value = "";
            }}
          />
          <span className="ml-auto hidden text-[0.625rem] text-muted-foreground sm:inline">Ctrl + Enter</span>
          <button
            type="button"
            onClick={post}
            disabled={busy || (!text.trim() && !image)}
            className="ml-2 h-8 rounded-full bg-ink px-4 text-[0.75rem] font-medium text-pearl transition active:scale-95 disabled:opacity-30 dark:bg-pearl dark:text-ink"
          >
            Add note
          </button>
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[0.625rem] text-muted-foreground">
        To save a passage, select text in a source and choose <span className="font-medium">Save to notebook</span>.
      </p>
    </div>
  );
}

const KIND = {
  text: { icon: TextAlignLeftIcon, label: "Note" },
  quote: { icon: QuotesIcon, label: "Passage" },
  image: { icon: ImageIcon, label: "Image" },
} as const;

function EntryCard({
  entry: e,
  titleOf,
  onZoom,
}: {
  entry: NotebookEntry;
  titleOf: (doc: string) => string;
  onZoom: (src: string) => void;
}) {
  const { actions, perms, canRemove, jumpTo, setNotebookOpen } = useRoom();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.text);
  const Kind = KIND[e.kind];

  const save = () => {
    const body = draft.trim().slice(0, MAX_TEXT);
    if (body !== e.text && (body || e.kind !== "text")) actions.editNotebook(e.id, body);
    setEditing(false);
  };

  const openSource = () => {
    if (!e.quote) return;
    jumpTo(e.quote.doc, e.quote.block);
    // On narrow screens the drawer covers the document, so get out of the way.
    if (window.innerWidth < 1024) setNotebookOpen(false);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
      className="group rounded-2xl bg-card/70 p-4 ring-1 ring-(--hairline)"
    >
      <div className="flex items-center gap-2">
        <Avatar actor={e.author} size={22} />
        <div className="min-w-0 flex-1 text-[0.6875rem] text-muted-foreground">
          <span className="font-semibold text-foreground/85">{e.author.name}</span> · {timeAgo(e.at)}
          {e.edited_by && e.edited_by.id !== e.author.id && (
            <span className="italic"> · edited by {e.edited_by.name}</span>
          )}
        </div>
        {/* Edit and delete appear on hover, in the header, so they take no space of their own. */}
        {!editing && perms.annotate && (
          <button
            type="button"
            onClick={() => {
              setDraft(e.text);
              setEditing(true);
            }}
            aria-label={e.text || e.kind === "text" ? "Edit" : "Add text"}
            title={e.text || e.kind === "text" ? "Edit" : "Add text"}
            className="grid size-6 place-items-center rounded-full text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-foreground/6 hover:text-foreground focus-visible:opacity-100"
          >
            <PencilSimpleIcon className="size-3.5" />
          </button>
        )}
        {!editing && canRemove(e.author.id) && (
          <button
            type="button"
            onClick={() => actions.removeFromNotebook(e.id)}
            aria-label="Delete"
            title="Delete"
            className="grid size-6 place-items-center rounded-full text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/8 hover:text-destructive focus-visible:opacity-100"
          >
            <TrashIcon className="size-3.5" />
          </button>
        )}
        <span className="flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-[0.625rem] text-muted-foreground">
          <Kind.icon className="size-3" /> {Kind.label}
        </span>
      </div>

      {e.kind === "quote" && e.quote && (
        <button
          type="button"
          onClick={openSource}
          className="mt-3 block w-full rounded-xl border-l-2 border-azure/70 bg-azure/[0.05] py-2 pr-3 pl-3 text-left transition hover:bg-azure/[0.09]"
        >
          <span className="block font-display text-[1.05rem] leading-snug text-foreground/90 italic">
            “{e.quote.text}”
          </span>
          <span className="mt-1.5 flex items-center gap-1 text-[0.6875rem] text-azure">
            <ArrowSquareOutIcon className="size-3" /> {titleOf(e.quote.doc)}
          </span>
        </button>
      )}

      {e.kind === "image" && e.image && (
        <button
          type="button"
          onClick={() => onZoom(e.image!)}
          className="mt-3 block w-full overflow-hidden rounded-xl"
          aria-label="Open image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the notebook */}
          <img
            src={e.image}
            alt={e.text || "Image from the notebook"}
            className="w-full transition duration-500 hover:scale-[1.02]"
          />
        </button>
      )}

      {editing ? (
        <div className="mt-3">
          <textarea
            autoFocus
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) save();
              if (ev.key === "Escape") {
                setDraft(e.text);
                setEditing(false);
              }
            }}
            maxLength={MAX_TEXT}
            rows={3}
            className="w-full resize-none rounded-xl bg-background/60 p-2.5 text-[0.875rem] ring-1 ring-(--hairline) outline-none focus:ring-azure/40"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDraft(e.text);
                setEditing(false);
              }}
              className="h-7 rounded-full px-3 text-[0.75rem] text-muted-foreground hover:bg-foreground/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="h-7 rounded-full bg-ink px-3 text-[0.75rem] font-medium text-pearl dark:bg-pearl dark:text-ink"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        e.text && <p className="mt-3 text-[0.875rem] leading-relaxed whitespace-pre-wrap break-words">{e.text}</p>
      )}
    </motion.li>
  );
}

// A hairline notebook with a pencil, for the empty state.
function EmptyNotebook({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <svg
        viewBox="0 0 160 120"
        className="h-28 w-auto text-foreground/50"
        fill="none"
        stroke="currentColor"
        aria-hidden
      >
        <path
          className="animate-thread-draw"
          pathLength={1}
          strokeWidth="1.2"
          strokeLinejoin="round"
          d="M30 20 h80 a6 6 0 0 1 6 6 v74 a6 6 0 0 1 -6 6 h-80 a6 6 0 0 1 -6 -6 v-74 a6 6 0 0 1 6 -6 z"
        />
        <path
          className="animate-thread-draw"
          style={{ animationDelay: "0.3s" }}
          pathLength={1}
          strokeWidth="1"
          d="M24 34 h-6 M24 52 h-6 M24 70 h-6 M24 88 h-6"
        />
        <path
          className="animate-thread-draw"
          style={{ animationDelay: "0.5s" }}
          pathLength={1}
          strokeWidth="1"
          d="M40 42 h56 M40 56 h48 M40 70 h52"
        />
        <path
          className="animate-thread-draw text-azure"
          style={{ animationDelay: "0.8s" }}
          pathLength={1}
          strokeWidth="1.2"
          strokeLinejoin="round"
          d="M118 40 l14 -14 l8 8 l-14 14 l-11 3 z M128 30 l8 8"
        />
      </svg>
      <div className="mt-4 font-display text-[1.5rem] leading-none">
        {filtered ? "Nothing of this kind yet" : "No notes yet"}
      </div>
      <p className="mt-2 max-w-[28ch] text-[0.75rem] text-muted-foreground">
        {filtered
          ? "Try another filter."
          : "Write the first one above, paste an image, or save a passage from a source."}
      </p>
    </div>
  );
}

export function NotebookButton() {
  const { state, setNotebookOpen } = useRoom();
  const n = state.notebook.length;
  return (
    <button
      type="button"
      onClick={() => setNotebookOpen(true)}
      aria-label={`Notebook${n ? `, ${n} notes` : ""}`}
      title="Room notebook"
      className="relative flex h-9 items-center gap-1.5 rounded-full bg-foreground/6 px-3 text-[0.8125rem] font-medium transition hover:bg-foreground/10"
    >
      <NotebookIcon className="size-4" />
      <span className="hidden md:inline">Notebook</span>
      {n > 0 && (
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-azure px-1 text-[0.625rem] font-semibold text-white tabular-nums">
          {n}
        </span>
      )}
    </button>
  );
}
