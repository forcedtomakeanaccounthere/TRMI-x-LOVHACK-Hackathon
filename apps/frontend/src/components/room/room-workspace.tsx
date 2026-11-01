"use client";

import {
  BooksIcon,
  ChatsCircleIcon,
  ClockCounterClockwiseIcon,
  FilesIcon,
  type Icon,
  MagicWandIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { Fragment, useState, useSyncExternalStore } from "react";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AiChat } from "./ai-chat";
import { Discussion } from "./discussion";
import { CatchupCard } from "./catchup-card";
import { DocViewer } from "./doc-viewer";
import { History } from "./history";
import { HuddleCaptions } from "./huddle";
import { type Identity, saveGuest, savedGuest, signedInIdentity } from "./identity";
import { GateShell, JoinGate } from "./join-gate";
import { Library } from "./library";
import { NotebookDrawer } from "./notebook";
import { SourcesPanel } from "./sources-panel";
import { type PanelTab, RoomProvider, useRoom } from "./store";
import { ArtifactDialog, Studio } from "./studio";
import { TopBar } from "./top-bar";
import { HuddleProvider } from "./use-huddle";
import type { DocContent } from "./types";

const noop = () => () => {};

// The room page on the client: who you are (account or guest name), then the workspace.
export function RoomWorkspace({ primary, bundled }: { primary: DocContent; bundled: DocContent[] }) {
  // Identity, the ledger and presence all live in the browser, so render after mount.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const session = useSession();
  const [guest, setGuest] = useState<Identity | null>(() => (typeof window === "undefined" ? null : savedGuest()));

  if (!mounted) return <div className="min-h-dvh" />;
  const me = session ? signedInIdentity(session.user) : guest;
  const path = `/r/${primary.id}`;

  if (!me)
    return (
      <JoinGate title={primary.title} nextPath={path} onJoin={(name, color) => setGuest(saveGuest(name, color))} />
    );

  return (
    <RoomProvider key={me.id} roomId={primary.id} primary={primary} bundled={bundled} me={me}>
      <Gatekeeper path={path} />
    </RoomProvider>
  );
}

function Gatekeeper({ path }: { path: string }) {
  const { kickedOut, me, state } = useRoom();
  if (kickedOut) {
    return (
      <GateShell>
        <h1 className="text-center font-display text-[2.2rem] leading-none">You were removed</h1>
        <p className="mt-3 text-center text-[0.875rem] text-muted-foreground">
          An admin removed you from this room. Ask them to invite you again.
        </p>
        <Link
          href="/"
          className="mt-7 flex h-11 items-center justify-center rounded-full bg-ink text-[0.875rem] font-medium text-pearl dark:bg-azure"
        >
          Back home
        </Link>
      </GateShell>
    );
  }
  if (!me.signedIn && !state.settings.allowGuests) {
    return (
      <GateShell>
        <h1 className="text-center font-display text-[2.2rem] leading-none">Members only</h1>
        <p className="mt-3 text-center text-[0.875rem] text-muted-foreground">
          The owner closed this room to guests. Sign in to join.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(path)}`}
          className="mt-7 flex h-11 items-center justify-center rounded-full bg-ink text-[0.875rem] font-medium text-pearl dark:bg-azure"
        >
          Sign in
        </Link>
      </GateShell>
    );
  }
  return (
    <HuddleProvider>
      <Shell />
    </HuddleProvider>
  );
}

const TABS: { id: PanelTab; label: string; icon: Icon }[] = [
  { id: "chat", label: "AI chat", icon: SparkleIcon },
  { id: "discussion", label: "Discussion", icon: ChatsCircleIcon },
  { id: "studio", label: "Studio", icon: MagicWandIcon },
  { id: "library", label: "Library", icon: BooksIcon },
  { id: "history", label: "History", icon: ClockCounterClockwiseIcon },
];

function Shell() {
  const { panelOpen, setPanelOpen, state } = useRoom();
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [mobile, setMobile] = useState<"sources" | "panel" | null>(null);
  const unread = state.chat.length;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar onToggleSources={() => setSourcesOpen((o) => !o)} onTogglePanel={() => setPanelOpen(!panelOpen)} />
      <div className="relative flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {sourcesOpen && (
            <motion.aside
              key="sources"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 288, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              className="hidden shrink-0 overflow-hidden border-r border-(--hairline) bg-[color-mix(in_oklab,var(--card)_55%,transparent)] lg:block"
            >
              <div className="h-full w-72">
                <SourcesPanel onCollapse={() => setSourcesOpen(false)} />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <main className="relative min-w-0 flex-1">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(47_91_255/0.08),transparent)]"
            aria-hidden
          />
          <DocViewer />
          <HuddleCaptions />
          <CatchupCard />
        </main>

        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.aside
              key="panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 440, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              className="hidden shrink-0 overflow-hidden border-l border-(--hairline) bg-[color-mix(in_oklab,var(--card)_55%,transparent)] lg:block"
            >
              <div className="h-full w-[440px]">
                <Panel />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Phones and tablets: the side panels open as sheets from a bottom bar. */}
        <nav className="liquid-glass liquid-glass-strong absolute inset-x-3 bottom-3 z-40 flex justify-around rounded-full p-1 lg:hidden">
          <MobileButton icon={FilesIcon} label="Sources" onClick={() => setMobile("sources")} />
          <MobileButton icon={SparkleIcon} label="Room" onClick={() => setMobile("panel")} badge={unread > 0} />
        </nav>
        <AnimatePresence>
          {mobile && (
            <>
              <motion.div
                className="absolute inset-0 z-50 bg-black/30 lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobile(null)}
              />
              <motion.div
                className="absolute inset-x-0 bottom-0 z-50 h-[82%] overflow-hidden rounded-t-[1.75rem] bg-background shadow-2xl ring-1 ring-(--hairline) lg:hidden"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", bounce: 0, duration: 0.45 }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 120 || info.velocity.y > 600) setMobile(null);
                }}
              >
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-foreground/15" />
                <button
                  type="button"
                  onClick={() => setMobile(null)}
                  aria-label="Close"
                  className="absolute top-3 right-3 z-10 grid size-8 place-items-center rounded-full bg-foreground/6"
                >
                  <XIcon className="size-4" />
                </button>
                <div className="h-[calc(100%-12px)]">{mobile === "sources" ? <SourcesPanel /> : <Panel />}</div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
      <ArtifactDialog />
      <NotebookDrawer />
    </div>
  );
}

function MobileButton({
  icon: Icon,
  label,
  onClick,
  badge,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-[0.8125rem] font-medium"
    >
      <Icon className="size-[18px]" /> {label}
      {badge && <span className="absolute top-2 right-[30%] size-2 rounded-full bg-azure" />}
    </button>
  );
}

function Panel() {
  const { tab, setTab } = useRoom();
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tabs with a hairline divider between each, so the labels don't run together. */}
      <div className="flex shrink-0 items-center border-b border-(--hairline) px-3 pt-2" role="tablist">
        {TABS.map(({ id, label, icon: Icon }, i) => {
          const on = tab === id;
          return (
            <Fragment key={id}>
              {i > 0 && <span className="h-4 w-px shrink-0 bg-(--hairline)" aria-hidden />}
              <button
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(id)}
                title={label}
                className={cn(
                  "relative flex h-11 flex-1 items-center justify-center gap-1.5 px-2 text-[0.75rem] font-medium whitespace-nowrap transition-colors",
                  on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon weight={on ? "fill" : "regular"} className={cn("size-4", on && id === "chat" && "text-azure")} />
                {/* Five tabs share the panel: only the open one is labelled until the screen is wide. */}
                <span className={cn(on ? "inline" : "hidden 2xl:inline", "max-[420px]:hidden")}>{label}</span>
                {on && (
                  <motion.span
                    layoutId="panel-tab"
                    className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-foreground"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
              </button>
            </Fragment>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "chat" && <AiChat />}
        {tab === "discussion" && <Discussion />}
        {tab === "studio" && <Studio />}
        {tab === "library" && <Library />}
        {tab === "history" && <History />}
      </div>
    </div>
  );
}
