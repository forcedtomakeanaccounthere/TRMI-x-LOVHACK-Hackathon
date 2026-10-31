"use client";

import { ArrowRightIcon, CaretDownIcon, DoorOpenIcon, PlusIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HeroLinkForm } from "@/components/landing/hero-link-form";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, ApiError } from "@/lib/api";
import { getFreshSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ROOM_COLORS } from "./demo-data";
import { newGroup } from "./groups-section";
import { saveRoomMeta } from "./local-prefs";
import { useDashboard } from "./store";

// Accepts a bare room code or any link containing /r/<code>, e.g. linkroom.app/r/x7Kp2qLm.
export function parseRoomCode(input: string): string | null {
  const value = input.trim().split(/[?#]/)[0]!.replace(/\/+$/, "");
  const match = value.match(/(?:^|\/r\/)([A-Za-z0-9_-]{6,21})$/);
  return match ? match[1]! : null;
}

const dialogClass =
  "liquid-glass liquid-glass-strong w-[min(32rem,calc(100%-2rem))] max-w-none rounded-[1.75rem] p-6 ring-0 sm:max-w-none";

export function JoinRoomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Signed in: POST /api/rooms/:id/join records the visit (so the room shows on the dashboard) and
  // tells us if the code is wrong. Guests, or a backend hiccup, just open the link.
  const join = async (code: string) => {
    const session = await getFreshSession().catch(() => null);
    if (session) {
      try {
        await api.joinRoom(code, session.access_token);
      } catch (err) {
        // "Room not found" is the join route's own 404. A bare "Not found" means the backend has no
        // such route (an outdated server), which is not the visitor's mistake.
        if (err instanceof ApiError && err.status === 404) {
          setError(
            err.message === "Room not found"
              ? "No room with that code. Check the link and try again."
              : "Couldn't reach the room service. Try again in a moment.",
          );
          return;
        }
      }
    }
    onOpenChange(false);
    router.push(`/r/${code}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClass}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const code = parseRoomCode(value);
            if (!code) {
              setError("That doesn't look like a room link or code.");
              return;
            }
            setBusy(true);
            await join(code);
            setBusy(false);
          }}
        >
          <span className="grid size-11 place-items-center rounded-2xl bg-azure/10 text-azure">
            <DoorOpenIcon weight="duotone" className="size-5" />
          </span>
          <DialogTitle className="mt-4 font-display text-[2rem] leading-none font-medium">
            Join a <span className="italic">room</span>
          </DialogTitle>
          <DialogDescription className="mt-2 text-[0.8125rem] text-muted-foreground">
            Paste the link someone shared, or type the 8-character room code.
          </DialogDescription>
          <div className="mt-5 flex h-13 items-center gap-2 rounded-full bg-foreground/5 py-1.5 pr-1.5 pl-5 ring-1 ring-(--hairline) focus-within:ring-ring">
            <input
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? "join-error" : undefined}
              placeholder="linkroom.app/r/x7Kp2qLm"
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-[0.875rem] outline-none placeholder:font-sans placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={!value.trim() || busy}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-[0.8125rem] font-medium text-pearl disabled:opacity-40 dark:bg-pearl dark:text-ink"
            >
              {busy ? "Joining…" : "Join"} <ArrowRightIcon className="size-3.5" />
            </button>
          </div>
          {error && (
            <p id="join-error" role="alert" className="mt-2 pl-5 text-[0.75rem] text-destructive">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NEW_GROUP = "__new__";
const NO_GROUP = "none";

export function NewRoomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-lenis-prevent className={cn(dialogClass, "max-h-[calc(100dvh-2rem)] overflow-y-auto")}>
        {/* Remounts on every open, so each new room starts from a clean form. */}
        {open && <NewRoomForm />}
      </DialogContent>
    </Dialog>
  );
}

function NewRoomForm() {
  const { state, actions } = useDashboard();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(ROOM_COLORS[0]);
  const [group, setGroup] = useState<string>(state.filters.group !== "any" ? state.filters.group : NO_GROUP);
  const [groupName, setGroupName] = useState("");
  const chosen = state.groups.find((g) => g.id === group);

  // Runs once the backend has created the room, just before the redirect. Name, colour and group are
  // kept in this browser until the backend stores rooms.title / color / group_id.
  const onCreated = (id: string) => {
    let groupId: string | null = group === NO_GROUP ? null : group;
    if (group === NEW_GROUP) {
      const label = groupName.trim();
      if (label) {
        const g = newGroup(label, color);
        actions.createGroup(g);
        groupId = g.id;
      } else groupId = null;
    }
    saveRoomMeta(id, { color, title: name.trim() || undefined, group_id: groupId });
  };

  return (
    <>
      <div className="eyebrow text-[0.5625rem] text-azure">New room</div>
      <DialogTitle className="mt-2 font-display text-[2rem] leading-none font-medium">
        What are we <span className="italic">reading?</span>
      </DialogTitle>
      <DialogDescription className="mt-2 text-[0.8125rem] text-muted-foreground">
        Name it, pick a colour and a group, then paste a link or drop a PDF.
      </DialogDescription>

      <label className="mt-5 block">
        <span className="eyebrow text-[0.5625rem] text-muted-foreground">Room name</span>
        <input
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          placeholder="Optional. Defaults to the page or file title"
          className="mt-2 h-11 w-full rounded-2xl bg-foreground/5 px-4 text-[0.9375rem] ring-1 ring-(--hairline) outline-none placeholder:text-muted-foreground focus:ring-ring"
        />
      </label>

      <div className="mt-4">
        <span className="eyebrow text-[0.5625rem] text-muted-foreground">Group</span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger className="mt-2 flex h-11 w-full items-center gap-2.5 rounded-2xl bg-foreground/5 px-4 text-left text-[0.9375rem] ring-1 ring-(--hairline) outline-none focus-visible:ring-ring data-[state=open]:ring-ring">
            {group === NEW_GROUP ? (
              <>
                <PlusIcon className="size-4 text-azure" />
                <span className="flex-1">New group</span>
              </>
            ) : chosen ? (
              <>
                <span className="size-2.5 rounded-full" style={{ backgroundColor: chosen.color }} />
                <span className="flex-1 truncate">{chosen.name}</span>
              </>
            ) : (
              <span className="flex-1 text-muted-foreground">No group, a room of its own</span>
            )}
            <CaretDownIcon className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) rounded-2xl p-1.5" data-lenis-prevent>
            <DropdownMenuRadioGroup value={group} onValueChange={setGroup}>
              <DropdownMenuRadioItem value={NO_GROUP}>No group</DropdownMenuRadioItem>
              {state.groups.length > 0 && <DropdownMenuSeparator />}
              {state.groups.map((g) => (
                <DropdownMenuRadioItem key={g.id} value={g.id}>
                  <span className="size-2 rounded-full" style={{ backgroundColor: g.color }} />
                  {g.name}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem value={NEW_GROUP}>
                <PlusIcon className="size-3.5" /> Create a new group…
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {group === NEW_GROUP && (
          <input
            autoFocus
            value={groupName}
            maxLength={60}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="New group name, e.g. Thesis reading"
            aria-label="New group name"
            className="mt-2 h-11 w-full rounded-2xl bg-foreground/5 px-4 text-[0.9375rem] ring-1 ring-(--hairline) outline-none placeholder:text-muted-foreground focus:ring-ring"
          />
        )}
      </div>

      <fieldset className="mt-4 mb-5">
        <legend className="eyebrow text-[0.5625rem] text-muted-foreground">Room colour</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ROOM_COLORS.map((c) => (
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
          <span className="ml-1 text-[0.75rem] text-muted-foreground">
            {chosen || group === NEW_GROUP ? "Used when the room has no group colour." : "Shown on the calendar and its card."}
          </span>
        </div>
      </fieldset>

      <HeroLinkForm onCreated={onCreated} />
    </>
  );
}
