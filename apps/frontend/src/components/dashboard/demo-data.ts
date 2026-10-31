import type { PastParticipant, Person, Profile, RoomGroup, RoomKind } from "@linkroom/shared";
import type { RoomView, ViewStatus } from "./types";

// Stand-in for the /dashboard API until apps/backend serves it (see CHECKLIST.md "Dashboard").
// Every date is relative to `now`, so the calendar always has live rooms in the current month.

export type DashboardData = {
  profile: Profile;
  rooms: RoomView[];
  groups: RoomGroup[];
  following: Person[];
  followers: Person[];
  participants: PastParticipant[];
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const person = (n: number, name: string, handle: string, color: string): Person => ({
  id: uuid(n),
  name,
  handle,
  color,
  avatar_url: null,
});

const PEOPLE = {
  arun: person(2, "Arun Mehta", "arun", "#ec4899"),
  mei: person(3, "Mei Tanaka", "mei", "#14b8a6"),
  leo: person(4, "Leo Fischer", "leo", "#8b5cf6"),
  priya: person(5, "Priya Nair", "priya", "#3b82f6"),
  sofia: person(6, "Sofia Reyes", "sofia", "#f97316"),
  kenji: person(7, "Kenji Watanabe", "kenji", "#eab308"),
  amara: person(8, "Amara Okafor", "amara", "#22c55e"),
  noah: person(9, "Noah Laurent", "noah", "#ef4444"),
  ines: person(10, "Inès Moreau", "ines", "#14b8a6"),
};

export const GROUP_COLORS = ["#3b82f6", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#eab308"] as const;

// Colours offered when creating a room. Red is left out: the calendar uses it for paused rooms.
export const ROOM_COLORS = ["#2f5bff", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#eab308"] as const;

type RoomSeed = {
  id: string;
  kind: RoomKind;
  title: string;
  source: string | null;
  status: ViewStatus;
  group: string | null;
  startedDaysAgo: number;
  // Days the room ran before closing (closed and archived rooms only).
  ranDays?: number;
  pausedDaysAgo?: number;
  activeHoursAgo: number;
  live?: number;
  people: Person[];
  counts: [attachments: number, comments: number, aiQueries: number];
};

const SEEDS: RoomSeed[] = [
  {
    id: "x7Kp2qLm",
    kind: "link",
    title: "Internet",
    source: "https://en.wikipedia.org/wiki/Internet",
    status: "running",
    group: "g-study",
    startedDaysAgo: 3,
    activeHoursAgo: 0,
    live: 4,
    people: [PEOPLE.arun, PEOPLE.mei, PEOPLE.leo, PEOPLE.priya, PEOPLE.kenji],
    counts: [3, 38, 6],
  },
  {
    id: "aT7nQe2v",
    kind: "pdf",
    title: "Attention Is All You Need",
    source: null,
    status: "running",
    group: "g-study",
    startedDaysAgo: 6,
    activeHoursAgo: 1,
    live: 2,
    people: [PEOPLE.priya, PEOPLE.arun, PEOPLE.amara],
    counts: [8, 21, 12],
  },
  {
    id: "Lw3hGdx9",
    kind: "link",
    title: "Launch week: what shipped",
    source: "https://linear.app/changelog",
    status: "running",
    group: "g-product",
    startedDaysAgo: 1,
    activeHoursAgo: 2,
    live: 3,
    people: [PEOPLE.sofia, PEOPLE.noah, PEOPLE.leo, PEOPLE.ines],
    counts: [2, 16, 4],
  },
  {
    id: "Fd10rPub",
    kind: "link",
    title: "The Federalist No. 10",
    source: "https://avalon.law.yale.edu/18th_century/fed10.asp",
    status: "running",
    group: "g-class",
    startedDaysAgo: 9,
    activeHoursAgo: 5,
    live: 0,
    people: [PEOPLE.amara, PEOPLE.kenji, PEOPLE.mei, PEOPLE.noah, PEOPLE.sofia, PEOPLE.ines],
    counts: [1, 48, 3],
  },
  {
    id: "Pg7Wk4ns",
    kind: "link",
    title: "How to Do Great Work",
    source: "https://paulgraham.com/greatwork.html",
    status: "paused",
    group: "g-books",
    startedDaysAgo: 12,
    pausedDaysAgo: 4,
    activeHoursAgo: 96,
    people: [PEOPLE.leo, PEOPLE.mei],
    counts: [0, 12, 2],
  },
  {
    id: "Md5fEtch",
    kind: "link",
    title: "Using the Fetch API",
    source: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch",
    status: "paused",
    group: "g-product",
    startedDaysAgo: 5,
    pausedDaysAgo: 2,
    activeHoursAgo: 50,
    people: [PEOPLE.noah, PEOPLE.ines],
    counts: [4, 9, 5],
  },
  {
    id: "Mt2bkII0",
    kind: "link",
    title: "Meditations, Book II",
    source: "https://www.gutenberg.org/ebooks/2680",
    status: "closed",
    group: "g-books",
    startedDaysAgo: 20,
    ranDays: 6,
    activeHoursAgo: 340,
    people: [PEOPLE.mei, PEOPLE.leo, PEOPLE.kenji],
    counts: [0, 27, 1],
  },
  {
    id: "Dd5chPdf",
    kind: "pdf",
    title: "Designing Data-Intensive Applications, ch. 5",
    source: null,
    status: "closed",
    group: "g-study",
    startedDaysAgo: 16,
    ranDays: 4,
    activeHoursAgo: 290,
    people: [PEOPLE.priya, PEOPLE.amara, PEOPLE.arun],
    counts: [6, 33, 9],
  },
  {
    id: "Cl26sumR",
    kind: "link",
    title: "State of the Climate 2026",
    source: "https://www.nature.com/articles/climate-2026",
    status: "closed",
    group: null,
    startedDaysAgo: 8,
    ranDays: 2,
    activeHoursAgo: 150,
    people: [PEOPLE.sofia, PEOPLE.kenji],
    counts: [2, 14, 3],
  },
  {
    id: "Q3cmpTd8",
    kind: "link",
    title: "Q3 competitor teardown",
    source: "https://www.notion.so/teardown",
    status: "archived",
    group: "g-product",
    startedDaysAgo: 27,
    ranDays: 5,
    activeHoursAgo: 520,
    people: [PEOPLE.noah, PEOPLE.sofia, PEOPLE.leo],
    counts: [5, 22, 7],
  },
  {
    id: "RscRfc01",
    kind: "link",
    title: "React Server Components RFC",
    source: "https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md",
    status: "archived",
    group: null,
    startedDaysAgo: 24,
    ranDays: 3,
    activeHoursAgo: 480,
    people: [PEOPLE.arun, PEOPLE.ines],
    counts: [1, 11, 2],
  },
  {
    id: "Old0drft",
    kind: "link",
    title: "Untitled draft notes",
    source: null,
    status: "deleted",
    group: null,
    startedDaysAgo: 14,
    ranDays: 1,
    activeHoursAgo: 320,
    people: [PEOPLE.mei],
    counts: [0, 2, 0],
  },
];

export function createDemoDashboard(now: Date, me: { id: string; name: string; email: string }): DashboardData {
  const DAY = 86_400_000;
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const myColor = "#2f5bff";

  const rooms: RoomView[] = SEEDS.map((s, i) => {
    const started = s.startedDaysAgo * DAY;
    const ended = s.ranDays !== undefined ? started - s.ranDays * DAY : null;
    return {
      id: s.id,
      kind: s.kind,
      title: s.title,
      source_url: s.source,
      status: s.status,
      role: "owner",
      group_id: s.group,
      color: ROOM_COLORS[i % ROOM_COLORS.length]!,
      created_at: at(started),
      closed_at: ended !== null ? at(ended) : null,
      paused_at: s.pausedDaysAgo !== undefined ? at(s.pausedDaysAgo * DAY) : null,
      last_activity_at: at(s.activeHoursAgo * 3_600_000),
      deleted_at: s.status === "deleted" ? at(2 * DAY) : null,
      live_count: s.live ?? 0,
      participants: s.people,
      // Groups highlight a little more than they comment.
      counts: { attachments: s.counts[0], highlights: Math.round(s.counts[1] * 1.3) + 2, comments: s.counts[1], ai_queries: s.counts[2] },
    };
  });

  const groups: RoomGroup[] = [
    { id: "g-study", name: "ML study group", color: GROUP_COLORS[0], created_at: at(40 * DAY) },
    { id: "g-product", name: "Product team", color: GROUP_COLORS[1], created_at: at(35 * DAY) },
    { id: "g-books", name: "Book club", color: GROUP_COLORS[2], created_at: at(30 * DAY) },
    { id: "g-class", name: "Civics seminar", color: GROUP_COLORS[3], created_at: at(12 * DAY) },
  ];

  // Everyone I've shared a room with, ranked by how often, then how recently.
  const tally = new Map<string, PastParticipant>();
  for (const r of rooms) {
    for (const p of r.participants) {
      const prev = tally.get(p.id);
      tally.set(p.id, {
        ...p,
        rooms_together: (prev?.rooms_together ?? 0) + 1,
        last_seen_at: prev && prev.last_seen_at > r.last_activity_at ? prev.last_seen_at : r.last_activity_at,
      });
    }
  }
  const participants = [...tally.values()].sort(
    (a, b) => b.rooms_together - a.rooms_together || b.last_seen_at.localeCompare(a.last_seen_at),
  );

  const following = [PEOPLE.arun, PEOPLE.mei, PEOPLE.priya, PEOPLE.sofia, PEOPLE.noah];
  const followers = [PEOPLE.arun, PEOPLE.leo, PEOPLE.mei, PEOPLE.kenji, PEOPLE.amara, PEOPLE.ines];

  return {
    profile: {
      id: me.id,
      name: me.name,
      handle: me.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "reader",
      color: myColor,
      avatar_url: null,
      email: me.email,
      bio: "Reads in company. Highlights too much.",
      created_at: at(62 * DAY),
      stats: {
        rooms_hosted: rooms.filter((r) => r.status !== "deleted").length,
        highlights: 214,
        followers: followers.length,
        following: following.length,
      },
    },
    rooms,
    groups,
    following,
    followers,
    participants,
  };
}
