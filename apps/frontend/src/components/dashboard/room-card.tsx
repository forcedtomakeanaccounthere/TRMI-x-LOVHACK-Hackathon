"use client";

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  ChatCircleIcon,
  DotsThreeIcon,
  FilePdfIcon,
  FolderSimpleIcon,
  HighlighterIcon,
  LinkIcon,
  LinkSimpleIcon,
  PaperclipIcon,
  PauseIcon,
  PlayIcon,
  SparkleIcon,
  StopIcon,
  TrashIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import Link from "next/link";
import { toast } from "sonner";
import { EASE_OUT_EXPO } from "@/components/fx/reveal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AvatarStack, StatusBadge, timeAgo } from "./primitives";
import { useDashboard } from "./store";
import type { RoomView } from "./types";

function host(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function roomUrl(path: string) {
  return `${window.location.origin}${path}`;
}

export function RoomCard({ room, onInvite }: { room: RoomView; onInvite: (room: RoomView) => void }) {
  const { groupById, roomHref } = useDashboard();
  const group = room.group_id ? groupById.get(room.group_id) : undefined;
  const dimmed = room.status === "archived" || room.status === "deleted";
  const accent = room.color ?? group?.color ?? null;
  const KindIcon = room.kind === "pdf" ? FilePdfIcon : LinkSimpleIcon;
  const source = host(room.source_url) ?? (room.kind === "pdf" ? "PDF document" : "Pasted text");

  return (
    // Fades in only. A layout animation here fought the smooth scroll when filters changed the list.
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
      className="group/card relative"
    >
      <div
        className={cn(
          "relative flex h-full flex-col rounded-[1.4rem] bg-card/80 p-4 ring-1 ring-(--hairline) transition-[box-shadow,transform] duration-500 ease-fluid hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-28px_rgb(14_30_90/0.45)] dark:bg-card/60",
          dimmed && "opacity-70 saturate-50",
        )}
      >
        {accent && (
          <span aria-hidden className="absolute inset-x-8 top-0 h-[3px] rounded-b-full" style={{ backgroundColor: accent }} />
        )}
        <div className="flex items-start justify-between gap-3">
          <StatusBadge status={room.status} live={room.live_count} />
          <RoomMenu room={room} onInvite={onInvite} />
        </div>

        <Link
          href={roomHref(room.id)}
          className="mt-4 block rounded-lg outline-none after:absolute after:inset-0 after:rounded-[1.4rem] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3
            className={cn(
              "line-clamp-2 font-display text-[1.45rem] leading-[1.05] font-medium",
              room.status === "deleted" && "line-through decoration-foreground/30",
            )}
          >
            {room.title}
          </h3>
        </Link>

        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          <KindIcon weight="light" className="size-3.5 shrink-0" />
          <span className="truncate">{source}</span>
        </div>

        {group && (
          <span
            className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium"
            style={{ backgroundColor: `${group.color}1a`, color: group.color }}
          >
            <FolderSimpleIcon weight="fill" className="size-3" />
            {group.name}
          </span>
        )}

        <div className="min-h-4 flex-1" />
        <div className="flex items-center justify-between gap-3 border-t border-(--hairline) pt-3.5">
          <AvatarStack people={room.participants} max={3} />
          <div className="flex items-center gap-2.5 text-[0.75rem] text-muted-foreground tabular-nums">
            <Count icon={HighlighterIcon} value={room.counts.highlights} label="highlights" />
            <Count icon={ChatCircleIcon} value={room.counts.comments} label="comments" />
            <Count icon={PaperclipIcon} value={room.counts.attachments} label="attachments" />
            <Count icon={SparkleIcon} value={room.counts.ai_queries} label="AI queries" accent />
          </div>
        </div>
        <div className="mt-2.5 text-[0.6875rem] text-muted-foreground/80">
          {room.status === "deleted" && room.deleted_at
            ? `Deleted ${timeAgo(room.deleted_at)} · you can restore it`
            : room.status === "paused" && room.paused_at
              ? `Paused ${timeAgo(room.paused_at)}`
              : `Active ${timeAgo(room.last_activity_at)}`}
        </div>
      </div>
    </motion.article>
  );
}

function Count({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: typeof ChatCircleIcon;
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <span className="flex items-center gap-1" title={`${value} ${label}`} aria-label={`${value} ${label}`}>
      <Icon weight={accent ? "fill" : "regular"} className={cn("size-3.5", accent && "text-azure")} />
      {value}
    </span>
  );
}

function RoomMenu({ room, onInvite }: { room: RoomView; onInvite: (room: RoomView) => void }) {
  const { state, actions, canPause, roomHref } = useDashboard();
  const live = room.status === "running" || room.status === "paused";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl(roomHref(room.id)));
      toast.success("Room link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Actions for ${room.title}`}
        className="relative z-10 -mt-1 -mr-1 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground data-[state=open]:bg-foreground/6"
      >
        <DotsThreeIcon weight="bold" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1.5" data-lenis-prevent>
        <DropdownMenuItem asChild>
          <Link href={roomHref(room.id)}>
            <ArrowSquareOutIcon /> Open room
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={copy}>
          <LinkIcon /> Copy link
        </DropdownMenuItem>
        {live && (
          <DropdownMenuItem onSelect={() => onInvite(room)}>
            <UserPlusIcon /> Invite people
          </DropdownMenuItem>
        )}

        {room.status !== "deleted" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderSimpleIcon /> Move to group
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52 rounded-2xl p-1.5">
                <DropdownMenuRadioGroup
                  value={room.group_id ?? "none"}
                  onValueChange={(v) => actions.moveRoom(room, v === "none" ? null : v)}
                >
                  <DropdownMenuRadioItem value="none">No group</DropdownMenuRadioItem>
                  {state.groups.map((g) => (
                    <DropdownMenuRadioItem key={g.id} value={g.id}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: g.color }} />
                      {g.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {room.role === "owner" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">Status</DropdownMenuLabel>
            {canPause && room.status === "running" && (
              <DropdownMenuItem onSelect={() => actions.setStatus(room, "paused")}>
                <PauseIcon /> Pause room
              </DropdownMenuItem>
            )}
            {room.status === "paused" && (
              <DropdownMenuItem onSelect={() => actions.setStatus(room, "running")}>
                <PlayIcon /> Resume room
              </DropdownMenuItem>
            )}
            {live && (
              <DropdownMenuItem onSelect={() => actions.setStatus(room, "closed")}>
                <StopIcon /> Close room
              </DropdownMenuItem>
            )}
            {room.status === "closed" && (
              <DropdownMenuItem onSelect={() => actions.setStatus(room, "running")}>
                <PlayIcon /> Reopen room
              </DropdownMenuItem>
            )}
            {(room.status === "closed" || live) && (
              <DropdownMenuItem onSelect={() => actions.setStatus(room, "archived")}>
                <ArchiveIcon /> Archive
              </DropdownMenuItem>
            )}
            {room.status === "archived" && (
              <DropdownMenuItem onSelect={() => actions.setStatus(room, "closed")}>
                <ArrowCounterClockwiseIcon /> Unarchive
              </DropdownMenuItem>
            )}
            {room.status === "deleted" ? (
              <DropdownMenuItem
                onSelect={() => {
                  actions.restore(room);
                  toast.success("Room restored");
                }}
              >
                <ArrowCounterClockwiseIcon /> Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  const previous = room.status;
                  if (previous === "deleted") return;
                  actions.remove(room);
                  toast("Room moved to Deleted", {
                    // Rolls back to "deleted" if the undo itself fails to save.
                    action: { label: "Undo", onClick: () => actions.restore({ ...room, status: "deleted" }, previous) },
                  });
                }}
              >
                <TrashIcon /> Delete
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
