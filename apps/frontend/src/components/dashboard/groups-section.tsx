"use client";

import type { Person, RoomGroup } from "@linkroom/shared";
import { ArrowRightIcon, CheckIcon, FolderSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useLenis } from "lenis/react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { EASE_OUT_EXPO } from "@/components/fx/reveal";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GROUP_COLORS } from "./demo-data";
import { AvatarStack, Panel, PanelHeader } from "./primitives";
import { useDashboard } from "./store";

// Groups club related rooms together (a course, a team, a book club).
export function GroupsSection() {
  const { state, dispatch, actions } = useDashboard();
  const lenis = useLenis();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RoomGroup | null>(null);

  // Filter first, scroll on the next frame: by then the room list has re-rendered, so the scroll
  // target is measured after the layout change rather than during it.
  const openGroup = (id: string) => {
    dispatch({ type: "filters", patch: { group: id, status: "all" } });
    requestAnimationFrame(() => lenis?.scrollTo("#rooms", { offset: -96 }));
  };

  return (
    <Panel id="groups" aria-label="Groups" className="scroll-mt-28">
      <PanelHeader
        eyebrow="Collections"
        title={
          <>
            Groups <span className="italic text-muted-foreground">&amp; projects</span>
          </>
        }
        action={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[0.8125rem] font-medium ring-1 ring-(--hairline) hover:bg-foreground/5"
          >
            <PlusIcon className="size-4" /> New group
          </button>
        }
      />

      <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
        {state.groups.map((g, i) => {
          const rooms = state.rooms.filter((r) => r.group_id === g.id && r.status !== "deleted");
          const running = rooms.filter((r) => r.status === "running").length;
          const paused = rooms.filter((r) => r.status === "paused").length;
          const people = uniquePeople(rooms.flatMap((r) => r.participants));
          return (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.05, ease: EASE_OUT_EXPO }}
              className="group/g relative overflow-hidden rounded-[1.4rem] bg-card/80 p-4 text-left ring-1 ring-(--hairline) transition-shadow duration-500 hover:shadow-[0_24px_50px_-28px_rgb(14_30_90/0.45)] dark:bg-card/60"
            >
              {/* The whole card opens the group; the delete button sits above this layer. */}
              <button
                type="button"
                onClick={() => openGroup(g.id)}
                aria-label={`Show rooms in ${g.name}`}
                className="absolute inset-0 z-0 rounded-[1.4rem] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
              <div
                className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full opacity-25 blur-2xl transition-transform duration-700 ease-fluid group-hover/g:scale-125"
                style={{ backgroundColor: g.color }}
              />
              <div className="relative flex items-start justify-between">
                <span
                  className="grid size-10 place-items-center rounded-xl"
                  style={{ backgroundColor: `${g.color}1f`, color: g.color }}
                >
                  <FolderSimpleIcon weight="duotone" className="size-5" />
                </span>
                <div className="relative z-10 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDeleting(g)}
                    aria-label={`Delete ${g.name}`}
                    title="Delete group"
                    className="grid size-8 place-items-center rounded-full text-muted-foreground opacity-0 transition-[opacity,background-color,color] group-hover/g:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                  <ArrowRightIcon className="pointer-events-none size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-500 ease-fluid group-hover/g:translate-x-0 group-hover/g:opacity-100" />
                </div>
              </div>
              <h3 className="relative mt-4 font-display text-[1.45rem] leading-none font-medium">{g.name}</h3>
              <p className="relative mt-1.5 text-[0.75rem] text-muted-foreground">
                {rooms.length} room{rooms.length === 1 ? "" : "s"}
                {running > 0 && ` · ${running} running`}
                {paused > 0 && ` · ${paused} paused`}
              </p>
              <div className="relative mt-4 flex items-center justify-between">
                <AvatarStack people={people} max={5} />
                <div className="flex gap-1" aria-hidden>
                  {rooms.slice(0, 6).map((r) => (
                    <span
                      key={r.id}
                      className={cn("h-5 w-1 rounded-full", r.status === "paused" && "animate-blink-soft")}
                      style={{ backgroundColor: r.status === "running" || r.status === "paused" ? g.color : "var(--hairline)" }}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {state.groups.length === 0 && (
        <div className="mt-5 grid place-items-center rounded-[1.4rem] border border-dashed border-(--hairline) py-12 text-center">
          <p className="font-display text-[1.5rem] italic">No groups yet.</p>
          <p className="mt-2 max-w-xs text-[0.8125rem] text-muted-foreground">
            Club rooms for a course, a team or a book club. Create one, then pick it when you make a room.
          </p>
        </div>
      )}

      <DeleteGroupDialog group={deleting} onClose={() => setDeleting(null)} />
      <NewGroupDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(name, color) => {
          actions.createGroup(newGroup(name, color));
          toast.success(`Group “${name}” created`, { description: "Move rooms into it from a room's menu." });
        }}
      />
    </Panel>
  );
}

export function newGroup(name: string, color: string): RoomGroup {
  return { id: `g-${Date.now().toString(36)}`, name, color, created_at: new Date().toISOString() };
}

function uniquePeople(people: Person[]) {
  return [...new Map(people.map((p) => [p.id, p])).values()];
}

function NewGroupDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(GROUP_COLORS[0]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="liquid-glass liquid-glass-strong w-[min(26rem,calc(100%-2rem))] max-w-none rounded-[1.75rem] p-6 ring-0 sm:max-w-none">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onCreate(name.trim(), color);
            setName("");
            onClose();
          }}
        >
          <div className="eyebrow text-[0.5625rem] text-azure">New collection</div>
          <DialogTitle className="mt-2 font-display text-[1.9rem] leading-none font-medium">
            Name your <span className="italic">group</span>
          </DialogTitle>
          <DialogDescription className="mt-2 text-[0.8125rem] text-muted-foreground">
            A course, a team, a reading list. Rooms inside it share a colour on the calendar.
          </DialogDescription>
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Thesis reading"
            className="mt-5 h-12 w-full rounded-2xl bg-foreground/5 px-4 text-[0.9375rem] ring-1 ring-(--hairline) outline-none placeholder:text-muted-foreground focus:ring-ring"
          />
          <fieldset className="mt-4">
            <legend className="eyebrow text-[0.5625rem] text-muted-foreground">Colour</legend>
            <div className="mt-2 flex gap-2">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-8 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                    color === c && "ring-2",
                  )}
                  style={{ backgroundColor: c, ["--tw-ring-color" as string]: c }}
                />
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={!name.trim()}
            className="mt-6 h-11 w-full rounded-full bg-ink text-[0.875rem] font-medium text-pearl transition-opacity disabled:opacity-40 dark:bg-pearl dark:text-ink"
          >
            Create group
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Deleting a group asks room by room: keep it (it stays, with no group) or delete it along with the group.
function DeleteGroupDialog({ group, onClose }: { group: RoomGroup | null; onClose: () => void }) {
  return (
    <Dialog open={group !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-lenis-prevent
        className="liquid-glass liquid-glass-strong w-[min(30rem,calc(100%-2rem))] max-w-none rounded-[1.75rem] p-6 ring-0 sm:max-w-none"
      >
        {group && <DeleteGroupForm group={group} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function DeleteGroupForm({ group, onDone }: { group: RoomGroup; onDone: () => void }) {
  const { state, actions } = useDashboard();
  const rooms = state.rooms.filter((r) => r.group_id === group.id && r.status !== "deleted");
  // Only rooms the user owns can be deleted; the rest can only be released from the group.
  const deletable = rooms.filter((r) => r.role === "owner");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const allPicked = deletable.length > 0 && deletable.every((r) => picked.has(r.id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <span className="grid size-11 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <TrashIcon weight="duotone" className="size-5" />
      </span>
      <DialogTitle className="mt-4 font-display text-[1.9rem] leading-none font-medium">
        Delete <span className="italic">{group.name}</span>?
      </DialogTitle>
      <DialogDescription className="mt-2 text-[0.8125rem] text-muted-foreground">
        {rooms.length
          ? "Tick the rooms to delete along with the group. Unticked rooms stay, without a group."
          : "This group has no rooms. Deleting it can't be undone."}
      </DialogDescription>

      {rooms.length > 0 && (
        <>
          <label className="mt-5 flex items-center gap-3 border-b border-(--hairline) px-2 pb-3 text-[0.8125rem] font-medium">
            <Check
              checked={allPicked}
              disabled={deletable.length === 0}
              onChange={() => setPicked(allPicked ? new Set() : new Set(deletable.map((r) => r.id)))}
            />
            Delete all {deletable.length} room{deletable.length === 1 ? "" : "s"} too
          </label>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {rooms.map((r) => {
              const own = r.role === "owner";
              return (
                <li key={r.id}>
                  <label
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-2 py-2 transition-colors",
                      own ? "cursor-pointer hover:bg-foreground/5" : "opacity-60",
                    )}
                  >
                    <Check checked={picked.has(r.id)} disabled={!own} onChange={() => toggle(r.id)} />
                    <span className="min-w-0 flex-1 truncate font-display text-[1.1rem]">{r.title}</span>
                    <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                      {!own ? "Not yours to delete" : picked.has(r.id) ? "Will be deleted" : "Stays, ungrouped"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onDone}
          className="h-11 flex-1 rounded-full text-[0.875rem] font-medium ring-1 ring-(--hairline) hover:bg-foreground/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            actions.deleteGroup(group.id, [...picked]);
            toast.success(`Deleted “${group.name}”`, {
              description: picked.size
                ? `${picked.size} room${picked.size === 1 ? "" : "s"} moved to Deleted; the rest stay ungrouped.`
                : rooms.length
                  ? "Its rooms stay, without a group."
                  : undefined,
            });
            onDone();
          }}
          className="h-11 flex-1 rounded-full bg-destructive text-[0.875rem] font-medium text-white"
        >
          {picked.size ? `Delete group + ${picked.size} room${picked.size === 1 ? "" : "s"}` : "Delete group"}
        </button>
      </div>
    </div>
  );
}

function Check({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="absolute inset-0 cursor-pointer appearance-none rounded-md ring-1 ring-(--hairline) transition-colors checked:bg-destructive checked:ring-destructive disabled:cursor-not-allowed"
      />
      {checked && <CheckIcon weight="bold" className="pointer-events-none relative size-3 text-white" />}
    </span>
  );
}
