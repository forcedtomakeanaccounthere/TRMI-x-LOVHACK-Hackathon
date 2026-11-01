"use client";

import {
  BrainIcon,
  CardsIcon,
  ChartPieSliceIcon,
  ExamIcon,
  ScrollIcon,
  SparkleIcon,
  TrashIcon,
  type Icon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ARTIFACT_META } from "./ai";
import { ArtifactView } from "./artifact-view";
import { ByLine, PreviewTag, Spinner } from "./bits";
import { useRoom } from "./store";
import type { Artifact, ArtifactKind } from "./types";

export const ARTIFACT_STYLE: Record<ArtifactKind, { icon: Icon; tint: string }> = {
  summary: { icon: ScrollIcon, tint: "#2f5bff" },
  quiz: { icon: ExamIcon, tint: "#f97316" },
  flashcards: { icon: CardsIcon, tint: "#14b8a6" },
  mindmap: { icon: BrainIcon, tint: "#8b5cf6" },
  infographic: { icon: ChartPieSliceIcon, tint: "#ec4899" },
};

// Like NotebookLM's Studio: make a summary, quiz, flashcards, mind map or infographic from the sources
// you pick. Everything made here is kept in Library → Artifacts.
export function Studio() {
  const { state, perms, setOpenArtifact } = useRoom();
  const [making, setMaking] = useState<ArtifactKind | null>(null);
  const open = (a: Artifact) => setOpenArtifact(a.id);

  return (
    <div data-lenis-prevent className="h-full overflow-y-auto overscroll-contain px-4 py-4">
      <div className="grid grid-cols-2 gap-2.5">
        {(Object.keys(ARTIFACT_META) as ArtifactKind[]).map((kind, i) => {
          const { icon: Icon, tint } = ARTIFACT_STYLE[kind];
          return (
            <motion.button
              key={kind}
              type="button"
              disabled={!perms.generate}
              onClick={() => setMaking(kind)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.97 }}
              className={cn(
                "group relative overflow-hidden rounded-2xl p-3.5 text-left ring-1 ring-(--hairline) transition disabled:opacity-50",
                kind === "infographic" && "col-span-2",
              )}
              style={{
                background: `linear-gradient(140deg, ${tint}14, transparent 70%)`,
              }}
            >
              <span
                className="grid size-9 place-items-center rounded-xl text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]"
                style={{ backgroundColor: tint }}
              >
                <Icon weight="fill" className="size-[18px]" />
              </span>
              <div className="mt-3 text-[0.875rem] font-semibold">{ARTIFACT_META[kind].label}</div>
              <div className="text-[0.6875rem] text-muted-foreground">{ARTIFACT_META[kind].blurb}</div>
              <SparkleIcon
                weight="fill"
                className="absolute top-3 right-3 size-3.5 opacity-0 transition group-hover:opacity-60"
                style={{ color: tint }}
              />
            </motion.button>
          );
        })}
      </div>

      <div className="mt-7 flex items-center justify-between">
        <h3 className="eyebrow text-[0.5625rem] text-muted-foreground">Made in this room</h3>
        <span className="text-[0.6875rem] text-muted-foreground">{state.artifacts.length}</span>
      </div>
      <ArtifactList artifacts={state.artifacts.slice(0, 6)} onOpen={open} />

      <GenerateDialog kind={making} onClose={() => setMaking(null)} onMade={open} />
    </div>
  );
}

export function ArtifactList({ artifacts, onOpen }: { artifacts: Artifact[]; onOpen: (a: Artifact) => void }) {
  const { canRemove, actions } = useRoom();
  if (artifacts.length === 0)
    return (
      <p className="mt-3 rounded-2xl border border-dashed border-(--hairline) p-5 text-center text-[0.75rem] text-muted-foreground">
        Nothing yet. Pick a format above.
      </p>
    );
  return (
    <ul className="mt-3 space-y-2">
      {artifacts.map((a) => {
        const { icon: Icon, tint } = ARTIFACT_STYLE[a.body.kind];
        return (
          <li
            key={a.id}
            className="group flex items-center gap-3 rounded-2xl bg-card/70 p-2.5 ring-1 ring-(--hairline) transition hover:ring-azure/30"
          >
            <button
              type="button"
              onClick={() => onOpen(a)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-xl"
                style={{ backgroundColor: `${tint}1f`, color: tint }}
              >
                <Icon weight="fill" className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-[0.8125rem] font-medium">
                  <span className="truncate">{a.title}</span>
                  {a.preview && <PreviewTag />}
                </span>
                <ByLine actor={a.author} at={a.at} />
              </span>
            </button>
            {canRemove(a.author.id) && (
              <button
                type="button"
                aria-label={`Delete ${a.title}`}
                onClick={() => actions.removeArtifact(a.id)}
                className="p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
              >
                <TrashIcon className="size-4" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// The one artifact viewer in the room, opened from Studio, Library or by following someone.
export function ArtifactDialog() {
  const { state, openArtifact, setOpenArtifact } = useRoom();
  const artifact = state.artifacts.find((a) => a.id === openArtifact) ?? null;
  const onClose = () => setOpenArtifact(null);
  return (
    <Dialog open={!!artifact} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] min-w-0 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[1.75rem] p-5 sm:max-w-3xl sm:p-7"
        data-lenis-prevent
      >
        <DialogTitle className="sr-only">{artifact?.title}</DialogTitle>
        <DialogDescription className="sr-only">Generated artifact</DialogDescription>
        {artifact && <ArtifactView artifact={artifact} />}
      </DialogContent>
    </Dialog>
  );
}

function GenerateDialog({
  kind,
  onClose,
  onMade,
}: {
  kind: ArtifactKind | null;
  onClose: () => void;
  onMade: (a: Artifact) => void;
}) {
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden rounded-[1.75rem] p-5 sm:max-w-md sm:p-6">
        {kind && <GenerateForm key={kind} kind={kind} onClose={onClose} onMade={onMade} />}
      </DialogContent>
    </Dialog>
  );
}

function GenerateForm({
  kind,
  onClose,
  onMade,
}: {
  kind: ArtifactKind;
  onClose: () => void;
  onMade: (a: Artifact) => void;
}) {
  const { state, included, actions, contents } = useRoom();
  const docs = state.docs.filter((d) => d.kind !== "video");
  const [chosen, setChosen] = useState<Set<string>>(new Set(included));
  const [title, setTitle] = useState(
    `${ARTIFACT_META[kind].label}${docs.length === 1 ? ` · ${docs[0]!.title}` : ""}`.slice(0, 80),
  );
  const [busy, setBusy] = useState(false);
  const { icon: Icon, tint } = ARTIFACT_STYLE[kind];

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const make = async () => {
    setBusy(true);
    const artifact = await actions.generate(kind, [...chosen], title.trim() || ARTIFACT_META[kind].label);
    setBusy(false);
    if (artifact) {
      onClose();
      onMade(artifact);
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-3 pr-7">
        <span className="grid size-11 place-items-center rounded-2xl text-white" style={{ backgroundColor: tint }}>
          <Icon weight="fill" className="size-5" />
        </span>
        <div className="min-w-0">
          <DialogTitle className="font-display text-[1.75rem] leading-none font-normal">
            New {ARTIFACT_META[kind].label.toLowerCase()}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[0.75rem]">Choose which sources it should use.</DialogDescription>
        </div>
      </div>

      <label className="mt-5 block text-[0.75rem] font-medium">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          className="mt-1.5 h-10 w-full rounded-xl bg-background px-3 text-[0.875rem] ring-1 ring-(--hairline) outline-none focus:ring-azure/50"
        />
      </label>

      <div className="mt-4 flex items-center justify-between text-[0.75rem] font-medium">
        Sources
        <button
          type="button"
          className="text-azure"
          onClick={() => setChosen(chosen.size === docs.length ? new Set() : new Set(docs.map((d) => d.id)))}
        >
          {chosen.size === docs.length ? "Clear" : "Select all"}
        </button>
      </div>
      <ul
        data-lenis-prevent
        className="mt-2 max-h-[min(14rem,40dvh)] min-h-0 space-y-1 overflow-y-auto overscroll-contain"
      >
        {docs.map((d) => {
          const c = contents[d.id];
          return (
            <li key={d.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-foreground/4">
                <Checkbox checked={chosen.has(d.id)} onCheckedChange={() => toggle(d.id)} />
                <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{d.title}</span>
                {typeof c === "object" && c.summary && (
                  <span className="shrink-0 text-[0.625rem] text-emerald-600 dark:text-emerald-400">
                    AI summary ready
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={make}
        disabled={busy || chosen.size === 0}
        className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-[0.875rem] font-medium text-pearl transition active:scale-[0.99] disabled:opacity-50 dark:bg-azure"
      >
        {busy ? <Spinner /> : <SparkleIcon weight="fill" className="size-4" />}
        {busy ? "Making it…" : `Make it from ${chosen.size} source${chosen.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
