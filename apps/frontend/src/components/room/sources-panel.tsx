"use client";

import { DotsThreeIcon, PlusIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Avatar } from "./bits";
import { AddSourceDialog } from "./add-source-dialog";
import { HuddleDock } from "./huddle";
import { docIcon } from "./library";
import { useRoom } from "./store";
import type { Peer } from "./use-room-channel";

// Left rail, like NotebookLM's Sources: every document in the room, ticked ones feed the AI and Studio.
export function SourcesPanel({ onCollapse }: { onCollapse?: () => void }) {
  const { state, activeDoc, setActiveDoc, excluded, toggleSource, perms, actions, events, me, primary, channel } =
    useRoom();
  const [adding, setAdding] = useState(false);
  const docs = state.docs;
  const readable = docs.filter((d) => d.kind !== "video");
  const allOn = readable.every((d) => !excluded.has(d.id));

  const markCount = (id: string) => state.annotations.filter((a) => a.doc === id).length;
  const readers = (id: string) => channel.peers.filter((p) => p.doc === id);
  const addedBy = (id: string) => events.find((e) => e.type === "doc.add" && e.doc.id === id)?.actor.id;

  // Mini presence map
  const [showPresenceMap, setShowPresenceMap] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <h2 className="eyebrow flex-1 text-[0.625rem] text-muted-foreground">Sources</h2>
        <button
          type="button"
          onClick={() => setShowPresenceMap(!showPresenceMap)}
          aria-label={showPresenceMap ? "Hide readers" : "Show readers"}
          className={cn(
            "grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-foreground/6 hover:text-foreground",
            showPresenceMap && "bg-azure/10 text-azure",
          )}
        >
          <motion.svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            animate={{ rotate: showPresenceMap ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <path
              d="M12 6L8 10L4 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        </button>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide sources"
            className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
          >
            <SidebarSimpleIcon className="size-4" />
          </button>
        )}
      </div>

      {showPresenceMap && channel.peers.length > 0 && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="mx-3 mb-3 overflow-hidden rounded-xl bg-card ring-1 ring-(--hairline)"
        >
          <div className="p-2.5">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[0.625rem] font-semibold text-foreground/70">Active Readers</span>
              <span className="text-[0.625rem] text-muted-foreground">{channel.peers.length}</span>
            </div>
            <div className="space-y-1">
              {docs.map((doc) => {
                const here = readers(doc.id);
                if (here.length === 0) return null;
                const Icon = docIcon(doc);
                return (
                  <div key={doc.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/4">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground/5 text-muted-foreground">
                      <Icon className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium">{doc.title}</span>
                    {/* Opens their document at the exact spot they are reading (asks them if it isn't known yet). */}
                    <PresenceAvatars peers={here} onNavigate={actions.goToReader} />
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      <div className="px-3">
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!perms.addSources}
          className="group flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-card text-[0.8125rem] font-medium ring-1 ring-(--hairline) transition hover:ring-azure/40 active:scale-[0.99] disabled:opacity-50"
        >
          <span className="grid size-6 place-items-center rounded-full bg-ink text-pearl transition-transform group-hover:rotate-90 dark:bg-azure">
            <PlusIcon weight="bold" className="size-3.5" />
          </span>
          Add sources
        </button>
      </div>

      {readable.length > 1 && (
        <label className="mx-4 mt-4 flex cursor-pointer items-center gap-2.5 text-[0.75rem] text-muted-foreground">
          <Checkbox
            checked={allOn}
            onCheckedChange={() => {
              for (const d of readable) if (allOn === !excluded.has(d.id)) toggleSource(d.id);
            }}
          />
          Use all sources
        </label>
      )}

      <ul data-lenis-prevent className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {docs.map((d, i) => {
          const Icon = docIcon(d);
          const on = d.id === activeDoc;
          const marks = markCount(d.id);
          const here = readers(d.id);
          const canRemove = d.id !== primary.id && (perms.manage || addedBy(d.id) === me.id) && perms.addSources;
          return (
            <motion.li
              key={d.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="group relative"
            >
              {on && (
                <motion.span
                  layoutId="source-active"
                  className="absolute inset-0 rounded-xl bg-card shadow-[0_8px_24px_-16px_rgb(14_30_90/0.5)] ring-1 ring-(--hairline)"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
                />
              )}
              <div className="relative flex items-center gap-2 rounded-xl px-2 py-2">
                <button
                  type="button"
                  onClick={() => setActiveDoc(d.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg",
                      on ? "bg-azure/10 text-azure" : "bg-foreground/5 text-muted-foreground",
                    )}
                  >
                    <Icon weight={on ? "fill" : "duotone"} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[0.8125rem]",
                        on ? "font-semibold" : "font-medium text-foreground/85",
                      )}
                    >
                      {d.title}
                    </span>
                    <span className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
                      {d.kind === "video" ? "Video · not processed" : `${marks} mark${marks === 1 ? "" : "s"}`}
                      {here.length > 0 && (
                        <span className="flex -space-x-1">
                          {here.slice(0, 3).map((p) => (
                            <span
                              key={p.id}
                              title={`${p.name} is here`}
                              className="size-2.5 rounded-full ring-1 ring-background"
                              style={{ backgroundColor: p.color }}
                            />
                          ))}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                {canRemove && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`More for ${d.title}`}
                      className="grid size-7 place-items-center rounded-lg text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-foreground/6 data-[state=open]:opacity-100"
                    >
                      <DotsThreeIcon weight="bold" className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" onSelect={() => actions.removeDoc(d.id)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {d.kind !== "video" && (
                  <Checkbox
                    checked={!excluded.has(d.id)}
                    onCheckedChange={() => toggleSource(d.id)}
                    aria-label={`Use ${d.title} in AI answers`}
                  />
                )}
              </div>
            </motion.li>
          );
        })}
      </ul>
      <HuddleDock />
      <AddSourceDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

// Shows avatars for peers on a document with tooltip
function PresenceAvatars({ peers, onNavigate }: { peers: Peer[]; onNavigate: (peerId: string) => void }) {
  if (peers.length === 0) return null;

  if (peers.length === 1) {
    const peer = peers[0]!;
    return (
      <button type="button" onClick={() => onNavigate(peer.id)} className="transition hover:scale-110">
        <Avatar actor={{ name: peer.name, color: peer.color }} size={20} ring />
      </button>
    );
  }

  const [first, ...rest] = peers;
  return (
    <Popover>
      <PopoverTrigger className="flex items-center -space-x-1.5">
        <Avatar actor={{ name: first!.name, color: first!.color }} size={20} ring />
        <span className="grid size-5 place-items-center rounded-full bg-foreground/10 text-[0.625rem] font-bold ring-2 ring-background">
          +{rest.length}
        </span>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-auto rounded-xl p-2">
        <div className="space-y-1">
          {peers.map((peer) => (
            <button
              key={peer.id}
              type="button"
              onClick={() => {
                onNavigate(peer.id);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-foreground/6"
            >
              <Avatar actor={{ name: peer.name, color: peer.color }} size={20} />
              <span className="text-[0.75rem] font-medium">{peer.name}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
