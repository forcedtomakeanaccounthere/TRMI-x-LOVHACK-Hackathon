"use client";

import type { AuthUser } from "@linkroom/shared";
import { DoorOpenIcon, InfoIcon, PlusIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { EASE_OUT_EXPO, SplitReveal } from "@/components/fx/reveal";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { getFreshSession, getSession, useSession } from "@/lib/session";
import { createDemoDashboard, type DashboardData } from "./demo-data";
import { foldSources, readRoomLedgers } from "./room-sources";
import { getProfileOverride, getRoomMeta, getSavedGroups } from "./local-prefs";
import { GroupsSection } from "./groups-section";
import { InviteDialog, type InviteTarget } from "./invite-dialog";
import { NotificationsPanel } from "./notifications-panel";
import { PausedRooms } from "./paused-rooms";
import { PeoplePanel } from "./people-panel";
import { ProfileCard } from "./profile-card";
import { ProfileDialog } from "./profile-dialog";
import { RoomCalendar } from "./room-calendar";
import { JoinRoomDialog, NewRoomDialog } from "./room-dialogs";
import { RoomsSection } from "./rooms-section";
import { Sidebar } from "./sidebar";
import { StatCards } from "./stat-cards";
import { type DataSource, DashboardProvider, useDashboard } from "./store";
import { Topbar } from "./topbar";
import { fromApiRoom, type Person, type RoomView } from "./types";

const noop = () => () => {};

// Everything here depends on the clock and the saved session, so it renders after mount only.
export function DashboardApp() {
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return mounted ? <Dashboard /> : <DashboardSkeleton />;
}

const GUEST = { id: "00000000-0000-4000-8000-000000000001", name: "Guest reader", email: "guest@linkroom.app" };

type Loaded = { data: DashboardData; source: DataSource };

// Layers what this browser has saved over loaded data: groups, each room's name, colour and group,
// and profile edits. A room pointing at a group that no longer exists drops back to no group.
function withLocalPrefs(data: DashboardData): DashboardData {
  const meta = getRoomMeta();
  const groups = getSavedGroups(data.profile.id) ?? data.groups;
  const groupIds = new Set(groups.map((g) => g.id));
  return {
    ...data,
    groups,
    profile: { ...data.profile, ...getProfileOverride(data.profile.id) },
    rooms: data.rooms.map((r) => {
      const m = meta[r.id] ?? {};
      const group = m.group_id !== undefined ? m.group_id : r.group_id;
      return {
        ...r,
        title: m.title ?? r.title,
        color: m.color ?? r.color,
        group_id: group && groupIds.has(group) ? group : null,
      };
    }),
  };
}

// Real rooms from GET /api/rooms/mine (active and deleted), on top of preview data for the parts the
// backend doesn't serve yet (people, groups, profile stats). Falls back to preview if the API fails.
// A person from the backend (UserSummary) in the dashboard's shape.
function toPerson(u: { id: string; display_name: string; avatar_color: string | null }): Person {
  return {
    id: u.id,
    name: u.display_name,
    handle:
      u.display_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 20) || "reader",
    color: u.avatar_color ?? colorFor(u.id),
    avatar_url: null,
  };
}

// A stable colour for someone who hasn't picked one.
const PALETTE = ["#2f5bff", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#eab308"];
function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

async function loadLive(user: AuthUser): Promise<Loaded> {
  const base = createDemoDashboard(new Date(), user);
  try {
    const session = await getFreshSession();
    if (!session) throw new Error("Signed out");
    const token = session.access_token;
    const [active, deleted] = await Promise.all([
      api.myRooms({ limit: 100 }, token),
      api.myRooms({ status: "deleted", limit: 100 }, token),
    ]);
    // People and profile load alongside; one of them failing leaves that part empty, never fake.
    const [profile, following, followers, participants] = await Promise.allSettled([
      api.me.profile(token),
      api.me.following(token),
      api.me.followers(token),
      api.me.participants(token),
    ]);
    const value = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
    // Sources attached inside a room come back as rooms of their own: fold them into their room.
    const rooms = foldSources(
      [...active.rooms, ...deleted.rooms].map((r) => fromApiRoom(r)),
      readRoomLedgers(),
    );
    const live = rooms.filter((r) => r.status !== "deleted");
    const hosted = live.filter((r) => r.role === "owner").length;
    const p = value(profile);
    const followingList = (value(following)?.users ?? []).map(toPerson);
    const followerList = (value(followers)?.users ?? []).map(toPerson);
    return {
      source: "live",
      data: withLocalPrefs({
        ...base,
        // Signed in: start with no groups rather than the demo ones, until the user makes their own.
        groups: [],
        rooms,
        following: followingList,
        followers: followerList,
        participants: (value(participants)?.participants ?? []).map((x) => ({
          ...toPerson({ id: x.user_id, display_name: x.display_name, avatar_color: x.avatar_color }),
          rooms_together: x.shared_rooms,
          last_seen_at: x.last_seen_at,
        })),
        profile: {
          ...base.profile,
          name: p?.display_name || base.profile.name,
          color: p?.avatar_color ?? base.profile.color,
          bio: p ? p.bio : null,
          created_at: p?.created_at ?? base.profile.created_at,
          stats: {
            rooms_hosted: hosted,
            // Highlights made in the rooms you're part of.
            highlights: live.reduce((n, r) => n + r.counts.highlights, 0),
            followers: followerList.length,
            following: followingList.length,
          },
        },
      }),
    };
  } catch {
    toast.error("Couldn't load your rooms", { description: "Is the backend running? Showing preview data for now." });
    return { source: "preview", data: withLocalPrefs(base) };
  }
}

function Dashboard() {
  const session = useSession();
  const user = session?.user ?? null;
  const userId = user?.id ?? null;
  const [guest] = useState<Loaded>(() => ({
    source: "preview",
    data: withLocalPrefs(createDemoDashboard(new Date(), GUEST)),
  }));
  const [fetched, setFetched] = useState<{ userId: string; result: Loaded } | null>(null);

  // Refetch only when the signed-in account changes, not when its token refreshes.
  useEffect(() => {
    const current = getSession()?.user;
    if (!userId || current?.id !== userId) return;
    let cancelled = false;
    void loadLive(current).then((result) => {
      if (!cancelled) setFetched({ userId: current.id, result });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!user) return <DashboardView loaded={guest} signedIn={false} />;
  if (fetched?.userId !== user.id) return <DashboardSkeleton />;
  return <DashboardView key={user.id} loaded={fetched.result} signedIn />;
}

function DashboardView({ loaded, signedIn }: { loaded: Loaded; signedIn: boolean }) {
  const initial = loaded.data;
  const [menuOpen, setMenuOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [invite, setInvite] = useState<InviteTarget>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const session = useSession();
  const token = session?.access_token;

  return (
    <DashboardProvider initial={initial} source={loaded.source}>
      <Backdrop />
      <div className="relative mx-auto max-w-[100rem] gap-5 px-3 py-3 md:px-5 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          className="liquid-glass sticky top-3 hidden h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-[1.75rem] p-4 lg:block"
          data-lenis-prevent
        >
          <Sidebar />
        </aside>

        <div className="min-w-0 pb-20">
          <Topbar onMenu={() => setMenuOpen(true)} onProfile={() => setProfileOpen(true)} />

          <main className="mt-6 space-y-5 md:mt-8">
            <Header
              signedIn={signedIn}
              source={loaded.source}
              onJoin={() => setJoinOpen(true)}
              onNew={() => setNewOpen(true)}
            />
            <StatCards />

            {/* Explicit columns: an implicit track would grow to the calendar's min width on phones. */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0 space-y-5">
                <RoomsSection onInvite={(room: RoomView) => setInvite({ room })} />
                <RoomCalendar />
                <GroupsSection />
              </div>
              <div className="space-y-5">
                <ProfileCard onEdit={() => setProfileOpen(true)} />
                {signedIn && (
                  <section className="liquid-glass rounded-[1.75rem] p-5">
                    <NotificationsPanel roomHref={(id) => `/r/${id}`} token={token} />
                  </section>
                )}
                <PausedRooms />
                <PeoplePanel onAddToRoom={(person: Person) => setInvite({ person })} />
              </div>
            </div>
          </main>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="liquid-glass liquid-glass-strong w-[18rem] border-0 p-4"
          data-lenis-prevent
        >
          <SheetTitle className="sr-only">Dashboard menu</SheetTitle>
          <Sidebar onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <JoinRoomDialog open={joinOpen} onOpenChange={setJoinOpen} />
      <NewRoomDialog open={newOpen} onOpenChange={setNewOpen} />
      <InviteDialog target={invite} onClose={() => setInvite(null)} />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </DashboardProvider>
  );
}

function greeting(hour: number) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Header({
  signedIn,
  source,
  onJoin,
  onNew,
}: {
  signedIn: boolean;
  source: DataSource;
  onJoin: () => void;
  onNew: () => void;
}) {
  const { state } = useDashboard();
  const name = state.profile.name;
  const now = new Date();
  const first = name.split(" ")[0] ?? name;
  const date = now.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" });

  return (
    <section id="overview" aria-label="Overview" className="scroll-mt-28 pt-2">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE_OUT_EXPO }}
            className="flex flex-wrap items-center gap-3"
          >
            <span className="eyebrow text-[0.625rem] text-muted-foreground">{date}</span>
            {source === "live" ? (
              <span
                title="Your rooms are real. People, groups and profile stats are preview data until their endpoints exist."
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[0.625rem] font-semibold text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Rooms live · people &amp; groups preview
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[0.625rem] font-semibold text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300">
                <InfoIcon weight="bold" className="size-3" />
                Preview data
              </span>
            )}
          </motion.div>
          <h1 className="mt-4 font-display text-[clamp(2.6rem,5.4vw,4.6rem)] font-normal">
            <SplitReveal text={`${greeting(now.getHours())},`} className="block" />
            <SplitReveal
              text={`${first}.`}
              className="block"
              delay={0.15}
              wordClassName={() => "italic text-royal-gradient"}
            />
          </h1>
          <p className="mt-4 max-w-lg text-[0.9375rem] leading-relaxed text-muted-foreground">
            Your rooms, the people you read with, and what&apos;s happening right now.
            {!signedIn && (
              <>
                {" "}
                <Link
                  href="/login?next=/dashboard"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Sign in
                </Link>{" "}
                to see your own name here.
              </>
            )}
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: EASE_OUT_EXPO }}
          className="flex shrink-0 gap-2"
        >
          <button
            type="button"
            onClick={onJoin}
            className="liquid-glass inline-flex h-12 items-center gap-2 rounded-full px-5 text-[0.875rem] font-medium"
          >
            <DoorOpenIcon className="size-[18px]" /> Join room
          </button>
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-ink pr-1.5 pl-5 text-[0.875rem] font-medium text-pearl shadow-[0_10px_30px_-10px_rgb(29_68_224/0.55)] dark:bg-pearl dark:text-ink"
          >
            New room
            <span className="grid size-9 place-items-center rounded-full bg-pearl/12 dark:bg-ink/8">
              <PlusIcon className="size-4" />
            </span>
          </button>
        </motion.div>
      </div>
    </section>
  );
}

// Soft colour fields behind the glass so the blur has something to refract.
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="hairline-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black,transparent)]" />
      <div className="animate-float-slow absolute -top-40 -left-32 size-[38rem] rounded-full bg-[radial-gradient(circle,var(--orb-1),transparent_65%)]" />
      <div className="absolute top-1/3 -right-40 size-[42rem] rounded-full bg-[radial-gradient(circle,var(--orb-2),transparent_65%)]" />
      <div className="absolute -bottom-48 left-1/4 size-[36rem] rounded-full bg-[radial-gradient(circle,var(--orb-3),transparent_65%)]" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="mx-auto max-w-[100rem] animate-pulse gap-5 px-3 py-3 md:px-5 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="hidden h-[calc(100dvh-1.5rem)] rounded-[1.75rem] bg-foreground/5 lg:block" />
      <div className="space-y-5">
        <div className="h-14 rounded-full bg-foreground/5" />
        <div className="h-40 rounded-[1.75rem] bg-foreground/4" />
        <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-[1.6rem] bg-foreground/5" />
          ))}
        </div>
        <div className="h-96 rounded-[1.75rem] bg-foreground/4" />
      </div>
    </div>
  );
}
