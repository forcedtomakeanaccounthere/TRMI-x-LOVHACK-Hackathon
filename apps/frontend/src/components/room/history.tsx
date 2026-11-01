"use client";

import {
  ArrowsOutCardinalIcon,
  ChatCircleTextIcon,
  ClockCounterClockwiseIcon,
  FilePlusIcon,
  FileXIcon,
  GearSixIcon,
  HighlighterIcon,
  type Icon,
  NotebookIcon,
  PenNibIcon,
  ScanIcon,
  ShieldCheckIcon,
  SparkleIcon,
  TextUnderlineIcon,
  TrashIcon,
  UserMinusIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "./bits";
import { useRoom } from "./store";
import type { LedgerEvent } from "./types";

type Line = {
  icon: Icon;
  tint: string;
  text: React.ReactNode;
  jump?: { doc: string; block: string };
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "sources", label: "Sources" },
  { id: "marks", label: "Annotations" },
  { id: "ai", label: "AI" },
  { id: "notebook", label: "Notebook" },
  { id: "people", label: "People" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const groupOf = (e: LedgerEvent): Filter | null => {
  switch (e.type) {
    case "doc.add":
    case "doc.remove":
      return "sources";
    case "annot.add":
    case "annot.remove":
    case "note.edit":
    case "annot.move":
      return "marks";
    case "thread.ask":
    case "artifact.add":
    case "artifact.remove":
      return "ai";
    case "notebook.add":
    case "notebook.edit":
    case "notebook.remove":
      return "notebook";
    case "role.set":
    case "member.kick":
    case "settings.update":
      return "people";
    default:
      return null; // chat and AI answers aren't history entries
  }
};

// Like Google Docs' version history: every change, who made it and when. It reads straight from the
// ledger, which is append-only, so entries can't be edited or removed.
// "Ana's " in a history line about someone else's mark.
function Owner({ name }: { name: string }) {
  return <em className="not-italic font-medium text-foreground">{name}&apos;s </em>;
}

export function History() {
  const { events, state, jumpTo } = useRoom();
  const [filter, setFilter] = useState<Filter>("all");
  const titles = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) if (e.type === "doc.add") m.set(e.doc.id, e.doc.title);
    for (const d of state.docs) m.set(d.id, d.title);
    return m;
  }, [events, state.docs]);
  // Who added each notebook entry, and what it was, for lines about editing or removing it.
  const notebookEntries = useMemo(() => {
    const m = new Map<string, { kind: string; author: { id: string; name: string } }>();
    for (const e of events)
      if (e.type === "notebook.add") m.set(e.entry.id, { kind: e.entry.kind, author: e.entry.author });
    return m;
  }, [events]);

  const annotationDoc = useMemo(() => {
    const m = new Map<string, { doc: string; block: string; kind: string; author: { id: string; name: string } }>();
    for (const e of events)
      if (e.type === "annot.add")
        m.set(e.annotation.id, {
          doc: e.annotation.doc,
          block: e.annotation.block,
          kind: e.annotation.kind,
          author: e.annotation.author,
        });
    return m;
  }, [events]);

  const describe = (e: LedgerEvent): Line | null => {
    const t = (id: string) => (
      <em className="not-italic font-medium text-foreground">{titles.get(id) ?? "a source"}</em>
    );
    switch (e.type) {
      case "doc.add":
        return {
          icon: FilePlusIcon,
          tint: "#2f5bff",
          text: <>attached {t(e.doc.id)}</>,
        };
      case "doc.remove":
        return {
          icon: FileXIcon,
          tint: "#ef4444",
          text: <>removed {t(e.doc_id)}</>,
        };
      case "annot.add": {
        const a = e.annotation;
        const where = <> in {t(a.doc)}</>;
        const jump = { doc: a.doc, block: a.block };
        if (a.kind === "highlight" || a.kind === "underline")
          return {
            icon: a.kind === "highlight" ? HighlighterIcon : TextUnderlineIcon,
            tint: a.color,
            text: (
              <>
                {a.kind === "highlight" ? "highlighted" : "underlined"} “{a.quote.slice(0, 60)}
                {a.quote.length > 60 ? "…" : ""}”{where}
              </>
            ),
            jump,
          };
        if (a.kind === "region")
          return {
            icon: HighlighterIcon,
            tint: a.color,
            text: <>highlighted an area{where}</>,
            jump,
          };
        if (a.kind === "ink")
          return {
            icon: PenNibIcon,
            tint: a.color,
            text: <>drew{where}</>,
            jump,
          };
        if (a.kind === "note")
          return {
            icon: ChatCircleTextIcon,
            tint: a.color,
            text: <>added a comment{where}</>,
            jump,
          };
        if (a.kind !== "ai") return null;
        return {
          icon: a.image ? ScanIcon : SparkleIcon,
          tint: "#8b5cf6",
          text: (
            <>
              {a.image ? "used the AI lens" : "opened an AI box"}
              {where}
            </>
          ),
          jump,
        };
      }
      case "annot.remove": {
        const a = annotationDoc.get(e.annotation_id);
        return {
          icon: TrashIcon,
          tint: "#94a3b8",
          text: (
            <>
              removed a{" "}
              {a?.kind === "ink" ? "drawing" : a?.kind === "note" ? "comment" : a?.kind === "ai" ? "AI box" : "mark"}
              {a && <> in {t(a.doc)}</>}
            </>
          ),
        };
      }
      case "note.edit": {
        const a = annotationDoc.get(e.annotation_id);
        const quote = (
          <>
            “{e.body.slice(0, 70)}
            {e.body.length > 70 ? "…" : ""}”
          </>
        );
        return {
          icon: ChatCircleTextIcon,
          tint: "#64748b",
          text:
            a && a.author.id !== e.actor.id ? (
              <>
                edited <Owner name={a.author.name} />
                comment to {quote}
              </>
            ) : (
              <>wrote {quote}</>
            ),
          jump: a,
        };
      }
      case "annot.move": {
        const a = annotationDoc.get(e.annotation_id);
        const what = a?.kind === "ai" ? "AI box" : "comment";
        return {
          icon: ArrowsOutCardinalIcon,
          tint: "#64748b",
          text:
            a && a.author.id !== e.actor.id ? (
              <>
                moved <Owner name={a.author.name} />
                {what}
                {a && <> in {t(a.doc)}</>}
              </>
            ) : (
              <>
                moved their {what}
                {a && <> in {t(a.doc)}</>}
              </>
            ),
          jump: a,
        };
      }
      case "thread.ask":
        return {
          icon: SparkleIcon,
          tint: "#8b5cf6",
          text: (
            <>
              asked the AI “{e.message.text.slice(0, 70)}
              {e.message.text.length > 70 ? "…" : ""}”
            </>
          ),
        };
      case "notebook.add": {
        const n = e.entry;
        return {
          icon: NotebookIcon,
          tint: "#0ea5e9",
          text:
            n.kind === "quote" && n.quote ? (
              <>
                saved a passage from {t(n.quote.doc)} to the notebook: “{n.quote.text.slice(0, 60)}
                {n.quote.text.length > 60 ? "…" : ""}”
              </>
            ) : n.kind === "image" ? (
              <>added an image to the notebook</>
            ) : (
              <>
                wrote in the notebook: “{n.text.slice(0, 60)}
                {n.text.length > 60 ? "…" : ""}”
              </>
            ),
          jump: n.kind === "quote" && n.quote ? { doc: n.quote.doc, block: n.quote.block } : undefined,
        };
      }
      case "notebook.edit": {
        const n = notebookEntries.get(e.entry_id);
        return {
          icon: NotebookIcon,
          tint: "#64748b",
          text:
            n && n.author.id !== e.actor.id ? (
              <>
                edited <Owner name={n.author.name} />
                notebook entry
              </>
            ) : (
              <>edited their notebook entry</>
            ),
        };
      }
      case "notebook.remove": {
        const n = notebookEntries.get(e.entry_id);
        return {
          icon: TrashIcon,
          tint: "#94a3b8",
          text:
            n && n.author.id !== e.actor.id ? (
              <>
                removed <Owner name={n.author.name} />
                notebook entry
              </>
            ) : (
              <>removed a notebook entry</>
            ),
        };
      }
      case "artifact.add":
        return {
          icon: SparkleIcon,
          tint: "#ec4899",
          text: (
            <>
              made <em className="not-italic font-medium text-foreground">{e.artifact.title}</em>
            </>
          ),
        };
      case "artifact.remove":
        return {
          icon: TrashIcon,
          tint: "#94a3b8",
          text: <>deleted an artifact</>,
        };
      case "role.set":
        return {
          icon: ShieldCheckIcon,
          tint: "#14b8a6",
          text: (
            <>
              made {e.name} {e.role === "admin" ? "an admin" : `an ${e.role}`}
            </>
          ),
        };
      case "member.kick":
        return {
          icon: UserMinusIcon,
          tint: "#ef4444",
          text: <>removed {e.name} from the room</>,
        };
      case "settings.update":
        return {
          icon: GearSixIcon,
          tint: "#64748b",
          text: <>changed the room settings</>,
        };
      default:
        return null;
    }
  };

  const shown = events.filter((e) => {
    const g = groupOf(e);
    return g && (filter === "all" || g === filter);
  });

  // Newest first, grouped by day.
  const days = new Map<string, LedgerEvent[]>();
  for (const e of [...shown].reverse()) {
    const day = new Date(e.at).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    (days.get(day) ?? days.set(day, []).get(day)!).push(e);
  }

  return (
    <div data-lenis-prevent className="h-full overflow-y-auto overscroll-contain px-4 py-4">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "h-7 shrink-0 rounded-full px-3 text-[0.6875rem] font-medium transition",
              filter === f.id
                ? "bg-ink text-pearl dark:bg-azure"
                : "bg-foreground/5 text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="pt-14 text-center text-muted-foreground">
          <ClockCounterClockwiseIcon className="mx-auto size-8 opacity-50" />
          <p className="mt-3 text-[0.8125rem]">Changes to the room show up here.</p>
        </div>
      )}

      {[...days].map(([day, list]) => (
        <section key={day} className="mt-5">
          <h3 className="eyebrow sticky top-0 z-10 bg-background/80 py-1 text-[0.5625rem] text-muted-foreground backdrop-blur">
            {day}
          </h3>
          <ol className="relative mt-2 ml-3 border-l border-(--hairline)">
            {list.map((e) => {
              const line = describe(e);
              if (!line) return null;
              const Icon = line.icon;
              const body = (
                <>
                  <span className="absolute top-1 -left-[0.8125rem] grid size-[1.625rem] place-items-center rounded-full bg-background ring-1 ring-(--hairline)">
                    <Icon weight="fill" className="size-3.5" style={{ color: line.tint }} />
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Avatar actor={e.actor} size={16} />
                    <span className="text-[0.75rem] font-semibold">{e.actor.name}</span>
                    <time dateTime={e.at} className="ml-auto text-[0.625rem] text-muted-foreground tabular-nums">
                      {new Date(e.at).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">{line.text}</p>
                </>
              );
              return (
                <li key={e.id} className="relative pb-4 pl-6">
                  {line.jump ? (
                    <button
                      type="button"
                      onClick={() => jumpTo(line.jump!.doc, line.jump!.block)}
                      className="w-full rounded-xl text-left transition hover:bg-foreground/[0.03]"
                    >
                      {body}
                    </button>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
