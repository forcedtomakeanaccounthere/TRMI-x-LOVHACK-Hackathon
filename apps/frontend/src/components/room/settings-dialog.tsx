"use client";

import { CheckIcon, MinusIcon, UserMinusIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Avatar } from "./bits";
import { can, roleOf } from "./ledger";
import { useRoom } from "./store";
import type { Role, RoomSettings } from "./types";

const ROLES: { id: Role; label: string; blurb: string }[] = [
  {
    id: "owner",
    label: "Owner",
    blurb: "Created the room. Everything, including archiving it.",
  },
  {
    id: "admin",
    label: "Admin",
    blurb: "Manages people, roles, sources and settings.",
  },
  {
    id: "editor",
    label: "Editor",
    blurb: "Adds sources, annotates, asks the AI, makes artifacts.",
  },
  { id: "viewer", label: "Viewer", blurb: "Reads, chats and follows along." },
];

const MATRIX: { label: string; roles: Role[] }[] = [
  {
    label: "Read, chat, follow people",
    roles: ["owner", "admin", "editor", "viewer"],
  },
  { label: "Highlight, draw, comment", roles: ["owner", "admin", "editor"] },
  { label: "Add sources", roles: ["owner", "admin", "editor"] },
  { label: "AI boxes, lens, Studio", roles: ["owner", "admin", "editor"] },
  { label: "Change roles, remove people", roles: ["owner", "admin"] },
];

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-lenis-prevent className="max-h-[90dvh] overflow-y-auto rounded-[1.75rem] p-7 sm:max-w-2xl">
        <DialogTitle className="font-display text-[2.1rem] leading-none font-normal">Room settings</DialogTitle>
        <DialogDescription className="text-[0.8125rem]">Who&apos;s in the room and what they can do.</DialogDescription>
        {open && <SettingsBody />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody() {
  const { me, role, channel, state, events, ownerId, actions, perms, isDemo } = useRoom();
  const roleFor = (id: string, signedIn: boolean): Role =>
    isDemo && !ownerId ? (state.roles[id] ?? "owner") : roleOf({ id, signedIn }, ownerId, state);

  // Everyone who is here now or has done something in the room.
  const members = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        color: string;
        signedIn: boolean;
        here: boolean;
      }
    >();
    for (const e of events) {
      if (e.actor.id === "linkroom") continue;
      map.set(e.actor.id, {
        id: e.actor.id,
        name: e.actor.name,
        color: e.actor.color,
        signedIn: !e.actor.id.startsWith("guest-"),
        here: false,
      });
    }
    for (const p of channel.peers)
      map.set(p.id, {
        id: p.id,
        name: p.name,
        color: p.color,
        signedIn: p.signedIn,
        here: true,
      });
    map.set(me.id, {
      id: me.id,
      name: me.name,
      color: me.color,
      signedIn: me.signedIn,
      here: true,
    });
    return [...map.values()].filter((m) => !state.kicked[m.id] || m.id === me.id);
  }, [events, channel.peers, me, state.kicked]);

  const setting = <K extends keyof RoomSettings>(key: K, value: RoomSettings[K]) =>
    actions.updateSettings({ [key]: value });

  return (
    <div className="mt-4 space-y-8">
      <section>
        <h3 className="eyebrow text-[0.5625rem] text-muted-foreground">People · {members.length}</h3>
        <ul className="mt-3 divide-y divide-(--hairline) rounded-2xl ring-1 ring-(--hairline)">
          {members.map((m) => {
            const theirs = roleFor(m.id, m.signedIn);
            const editable = m.id !== me.id && can.changeRole(role, theirs);
            return (
              <li key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="relative">
                  <Avatar actor={m} size={32} />
                  {m.here && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.875rem] font-medium">
                    {m.name}
                    {m.id === me.id && <span className="text-muted-foreground"> (you)</span>}
                  </div>
                  <div className="text-[0.6875rem] text-muted-foreground">
                    {m.signedIn ? "Signed in" : "Guest"}
                    {m.here ? " · here now" : ""}
                  </div>
                </div>
                {editable ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="h-8 rounded-full bg-foreground/5 px-3 text-[0.75rem] font-medium hover:bg-foreground/10">
                      {ROLES.find((r) => r.id === theirs)?.label} ▾
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuRadioGroup
                        value={theirs}
                        onValueChange={(v) => actions.setRole(m.id, m.name, v as Role)}
                      >
                        {ROLES.filter((r) => r.id !== "owner" && (r.id !== "admin" || role === "owner")).map((r) => (
                          <DropdownMenuRadioItem key={r.id} value={r.id} className="items-start py-2">
                            <div>
                              <div className="font-medium">{r.label}</div>
                              <div className="text-[0.6875rem] text-muted-foreground">{r.blurb}</div>
                            </div>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="rounded-full px-3 text-[0.75rem] text-muted-foreground">
                    {ROLES.find((r) => r.id === theirs)?.label}
                  </span>
                )}
                {editable && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => {
                      actions.kick(m.id, m.name);
                      toast.success(`${m.name} was removed`);
                    }}
                    className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-destructive/8 hover:text-destructive"
                  >
                    <UserMinusIcon className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {Object.keys(state.kicked).length > 0 && (
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">
            Removed: {Object.values(state.kicked).join(", ")}
          </p>
        )}
      </section>

      <section>
        <h3 className="eyebrow text-[0.5625rem] text-muted-foreground">Access</h3>
        <div className="mt-3 space-y-1 rounded-2xl ring-1 ring-(--hairline)">
          <Toggle
            label="Let guests in"
            hint="People without an account join with a name."
            on={state.settings.allowGuests}
            disabled={!perms.manage}
            onChange={(v) => setting("allowGuests", v)}
          />
          <Choice
            label="Guests join as"
            value={state.settings.guestRole}
            disabled={!perms.manage}
            onChange={(v) => setting("guestRole", v)}
          />
          <Choice
            label="Signed-in people join as"
            value={state.settings.memberRole}
            disabled={!perms.manage}
            onChange={(v) => setting("memberRole", v)}
          />
          <Toggle
            label="Viewers can use the AI chat"
            hint="Viewers can always read the AI boxes others made."
            on={state.settings.viewersUseAi}
            disabled={!perms.manage}
            onChange={(v) => setting("viewersUseAi", v)}
          />
        </div>
      </section>

      <section>
        <h3 className="eyebrow text-[0.5625rem] text-muted-foreground">What each role can do</h3>
        <div className="mt-3 overflow-x-auto rounded-2xl ring-1 ring-(--hairline)">
          <table className="w-full text-[0.75rem]">
            <thead>
              <tr className="border-b border-(--hairline) text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium" />
                {ROLES.map((r) => (
                  <th key={r.id} className={cn("px-2 py-2 font-medium", r.id === role && "text-azure")}>
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row) => (
                <tr key={row.label} className="border-b border-(--hairline) last:border-0">
                  <td className="px-3 py-2">{row.label}</td>
                  {ROLES.map((r) => (
                    <td key={r.id} className="px-2 py-2 text-center">
                      {row.roles.includes(r.id) ? (
                        <CheckIcon weight="bold" className="mx-auto size-3.5 text-emerald-500" />
                      ) : (
                        <MinusIcon className="mx-auto size-3.5 text-muted-foreground/50" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[0.6875rem] text-muted-foreground">
          Roles are enforced in the app for now; the backend will check them once room membership is stored there.
        </p>
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={cn("flex items-center gap-3 px-3.5 py-3", !disabled && "cursor-pointer")}>
      <div className="flex-1">
        <div className="text-[0.8125rem] font-medium">{label}</div>
        <div className="text-[0.6875rem] text-muted-foreground">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn(
          "relative h-6 w-10 rounded-full transition-colors disabled:opacity-50",
          on ? "bg-azure" : "bg-foreground/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-300 ease-fluid",
            on && "translate-x-4",
          )}
        />
      </button>
    </label>
  );
}

function Choice({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: "viewer" | "editor";
  disabled: boolean;
  onChange: (v: "viewer" | "editor") => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <div className="flex-1 text-[0.8125rem] font-medium">{label}</div>
      <div className="flex rounded-full bg-foreground/5 p-0.5">
        {(["viewer", "editor"] as const).map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => onChange(v)}
            className={cn(
              "h-7 rounded-full px-3 text-[0.75rem] capitalize transition",
              value === v ? "bg-card font-medium shadow-sm ring-1 ring-(--hairline)" : "text-muted-foreground",
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
