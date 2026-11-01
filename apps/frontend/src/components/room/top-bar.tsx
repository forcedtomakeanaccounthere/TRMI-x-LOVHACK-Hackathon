"use client";

import {
  ArrowLeftIcon,
  CopyIcon,
  CrosshairIcon,
  CursorIcon,
  EyeIcon,
  GearSixIcon,
  QrCodeIcon,
  ShareNetworkIcon,
  SidebarSimpleIcon,
  UserMinusIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Avatar } from "./bits";
import { can, roleOf } from "./ledger";
import { NotebookButton } from "./notebook";
import { SettingsDialog } from "./settings-dialog";
import { useRoom } from "./store";

const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
} as const;

export function TopBar({ onToggleSources, onTogglePanel }: { onToggleSources: () => void; onTogglePanel: () => void }) {
  const {
    primary,
    me,
    role,
    channel,
    following,
    setFollowing,
    actions,
    ownerId,
    state,
    isDemo,
    panelOpen,
    showCursors,
    setShowCursors,
  } = useRoom();
  const session = useSession();
  const [settings, setSettings] = useState(false);
  const peers = channel.peers;
  const roleFor = (id: string, signedIn: boolean) =>
    isDemo && !ownerId ? (state.roles[id] ?? "owner") : roleOf({ id, signedIn }, ownerId, state);

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-(--hairline) px-3 md:px-5">
      <Link
        href={session ? "/dashboard" : "/"}
        aria-label={session ? "Back to dashboard" : "Home"}
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/6 hover:text-foreground"
      >
        <ArrowLeftIcon className="size-[18px]" />
      </Link>
      <button
        type="button"
        onClick={onToggleSources}
        aria-label="Toggle sources"
        className="hidden size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/6 hover:text-foreground lg:grid"
      >
        <SidebarSimpleIcon className="size-[18px]" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate font-display text-[1.35rem] leading-none md:text-[1.6rem]">{primary.title}</h1>
          <span
            className={cn(
              "hidden shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold tracking-wide uppercase sm:flex",
              channel.status === "live"
                ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                : "bg-foreground/6 text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                channel.status === "live" ? "animate-pulse bg-emerald-500" : "bg-muted-foreground",
              )}
            />
            {channel.status === "live"
              ? `Live · ${peers.length + 1}`
              : channel.status === "solo"
                ? "Solo"
                : "Connecting"}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
          You&apos;re {me.name} · {ROLE_LABEL[role]}
          {!me.signedIn && " (guest)"}
        </div>
      </div>

      {/* Who's here: click someone to follow them, or (admins) to remove them. */}
      <div className="flex items-center -space-x-2">
        {peers.slice(0, 4).map((p) => {
          const theirRole = roleFor(p.id, p.signedIn);
          return (
            <Popover key={p.id}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={p.name}
                  className="relative rounded-full transition-transform hover:z-10 hover:-translate-y-0.5"
                >
                  <Avatar actor={p} size={32} ring />
                  {following === p.id && (
                    <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-background">
                      <EyeIcon weight="fill" className="size-3" style={{ color: p.color }} />
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 rounded-2xl p-2">
                <div className="flex items-center gap-2.5 p-2">
                  <Avatar actor={p} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-[0.875rem] font-semibold">{p.name}</div>
                    <div className="text-[0.6875rem] text-muted-foreground">
                      {ROLE_LABEL[theirRole]}
                      {!p.signedIn && " · guest"}
                    </div>
                  </div>
                </div>
                {(p.doc || p.artifact) && (
                  <div className="mx-2 mb-1.5 rounded-xl bg-foreground/[0.04] px-2.5 py-2 text-[0.6875rem] text-muted-foreground">
                    {p.doc && (
                      <div className="truncate">
                        Reading{" "}
                        <span className="font-medium text-foreground">
                          {state.docs.find((d) => d.id === p.doc)?.title ?? "…"}
                        </span>
                      </div>
                    )}
                    {p.artifact && (
                      <div className="truncate">
                        Viewing{" "}
                        <span className="font-medium text-foreground">
                          {state.artifacts.find((a) => a.id === p.artifact)?.title ?? "an artifact"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setFollowing(following === p.id ? null : p.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-[0.8125rem] hover:bg-foreground/5",
                    following === p.id && "bg-azure/8 text-azure",
                  )}
                >
                  <EyeIcon weight={following === p.id ? "fill" : "regular"} className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {following === p.id ? "Stop following" : `Follow ${p.name.split(" ")[0]}`}
                    {following !== p.id && (
                      <span className="block text-[0.6875rem] text-muted-foreground">
                        Your view moves with them: documents, scrolling, artifacts
                      </span>
                    )}
                  </span>
                </button>
                {can.changeRole(role, theirRole) && (
                  <button
                    type="button"
                    onClick={() => {
                      actions.kick(p.id, p.name);
                      toast.success(`${p.name} was removed`);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[0.8125rem] text-destructive hover:bg-destructive/8"
                  >
                    <UserMinusIcon className="size-4" /> Remove from room
                  </button>
                )}
              </PopoverContent>
            </Popover>
          );
        })}
        {peers.length > 4 && (
          <button
            type="button"
            onClick={() => setSettings(true)}
            className="grid size-8 place-items-center rounded-full bg-foreground/8 text-[0.6875rem] font-semibold ring-2 ring-background"
          >
            +{peers.length - 4}
          </button>
        )}
        <Avatar actor={me} size={32} ring className="ml-1 hidden sm:grid" />
      </div>

      {/* Hide other people's cursors when they distract (the person you follow stays visible). */}
      <button
        type="button"
        onClick={() => setShowCursors(!showCursors)}
        aria-pressed={!showCursors}
        aria-label={showCursors ? "Hide other people's cursors" : "Show other people's cursors"}
        title={showCursors ? "Hide cursors" : "Show cursors"}
        className={cn(
          "relative grid size-9 place-items-center rounded-full transition hover:bg-foreground/6",
          showCursors ? "text-muted-foreground hover:text-foreground" : "bg-foreground/6 text-foreground",
        )}
      >
        <CursorIcon weight={showCursors ? "regular" : "fill"} className="size-[18px]" />
        {!showCursors && <span className="absolute h-[1.5px] w-5 rotate-45 rounded-full bg-current" aria-hidden />}
      </button>
      <FocusButton />
      <NotebookButton />
      <SharePopover />
      <button
        type="button"
        onClick={() => setSettings(true)}
        aria-label="Room settings"
        className="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/6 hover:text-foreground"
      >
        <GearSixIcon className="size-[18px]" />
      </button>
      <div className="hidden md:block">
        <ThemeToggle />
      </div>
      <button
        type="button"
        onClick={onTogglePanel}
        aria-label={panelOpen ? "Hide panel" : "Show panel"}
        className="hidden size-9 place-items-center rounded-full text-muted-foreground hover:bg-foreground/6 hover:text-foreground lg:grid"
      >
        <SidebarSimpleIcon className="size-[18px] -scale-x-100" />
      </button>
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </header>
  );
}

// Laser focus: "everyone look here". While it's on, everyone else follows you and sees your pointer
// as a laser; they go back to where they were when you stop.
function FocusButton() {
  const { focus, perms, channel, isDemo } = useRoom();
  const someoneElse = focus.leader;
  if (isDemo || channel.status !== "live" || !perms.annotate) return null;
  const label = focus.mine
    ? "Stop focus"
    : someoneElse
      ? `${someoneElse.name.split(" ")[0]} is focusing`
      : "Everyone look here";
  return (
    <button
      type="button"
      onClick={focus.mine ? focus.stop : focus.start}
      disabled={!!someoneElse}
      title={
        focus.mine
          ? "Let everyone go back to where they were"
          : "Bring everyone to where you are, with your pointer as a laser"
      }
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-medium transition disabled:opacity-50",
        focus.mine ? "bg-red-500 text-white hover:bg-red-600" : "bg-foreground/6 hover:bg-foreground/10",
      )}
    >
      <CrosshairIcon weight={focus.mine ? "fill" : "regular"} className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function SharePopover() {
  const [qr, setQr] = useState(false);
  const url = typeof window === "undefined" ? "" : location.href.split("#")[0]!;
  return (
    <Popover onOpenChange={(o) => !o && setQr(false)}>
      <PopoverTrigger className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[0.8125rem] font-medium text-pearl shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] transition active:scale-[0.97] dark:bg-azure">
        <ShareNetworkIcon weight="fill" className="size-4" />
        <span className="hidden sm:inline">Share</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-2xl p-4">
        <div className="font-display text-[1.35rem] leading-none">Invite to read</div>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">
          Anyone with the link can join, as a guest if they aren&apos;t signed in.
        </p>
        <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-foreground/5 p-1 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem]">{url.replace(/^https?:\/\//, "")}</span>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success("Link copied"))}
            className="flex h-8 items-center gap-1 rounded-lg bg-card px-2.5 text-[0.75rem] font-medium ring-1 ring-(--hairline)"
          >
            <CopyIcon className="size-3.5" /> Copy
          </button>
        </div>
        <button
          type="button"
          onClick={() => setQr((q) => !q)}
          className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-azure"
        >
          <QrCodeIcon className="size-4" /> {qr ? "Hide QR code" : "Show QR code"}
        </button>
        {qr && (
          <div className="mt-3 grid place-items-center rounded-xl bg-white p-4">
            <QRCodeSVG value={url} size={180} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
