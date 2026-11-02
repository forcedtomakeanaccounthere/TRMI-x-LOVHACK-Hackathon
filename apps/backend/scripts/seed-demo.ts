// Seeds the demo accounts (packages/shared/src/demo.ts) with rooms full of activity, so judges can sign
// in from the sign-in page and try every feature at once.
//
//   npm run seed:demo -w apps/backend           (backend at http://localhost:4000)
//   SEED_API_URL=https://… npm run seed:demo -w apps/backend
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from the repo's .env) to create the two accounts
// already verified. Everything else goes through the real API as those users would do it, so the AI
// indexes the documents, Studio writes real artifacts and the huddle gets real AI notes.
// Running it again keeps the accounts and skips the rooms if the demo room is already there.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DEMO_ACCOUNTS, DEMO_ROOM_TITLE, type DemoAccount } from "@linkroom/shared";

const API = (process.env.SEED_API_URL ?? process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type User = DemoAccount & { id: string; token: string };
type Actor = { id: string; name: string; color: string };

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${init.method ?? "POST"} ${path} → ${res.status} ${body.error ?? ""}`);
  return body;
}

// --- The accounts ---

async function ensureAccount(account: DemoAccount): Promise<User> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the repo's .env)");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { name: account.name },
  });
  if (error && error.code !== "email_exists") throw error;
  if (error) {
    // Already there: make sure it still signs in with the published password and is verified.
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = data.users.find((u) => u.email === account.email);
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, {
        password: account.password,
        email_confirm: true,
        user_metadata: { name: account.name },
      });
    }
  }
  const session = await call<{ access_token: string; user: { id: string } }>("/api/auth/login", {
    body: { email: account.email, password: account.password },
  });
  await call("/api/me/profile", { token: session.access_token }); // creates the profile row
  console.log(`✓ ${account.name} <${account.email}>`);
  return { ...account, id: session.user.id, token: session.access_token };
}

// --- The documents ---

const PERCEPTION = `Robot Perception 101

A robot can only act on what it can sense. Perception is the chain that turns raw sensor signals into a model of the world the robot can plan with: where it is, what is around it, and how things are moving.

Proprioception means self-sensing. Encoders on each joint report angles, torque sensors report the load on a joint, and an inertial measurement unit (IMU) combines accelerometers and gyroscopes to estimate how the body is tilting and accelerating.

Exteroception means sensing the outside world. Cameras give rich colour and texture but no direct depth. Stereo cameras recover depth from the disparity between two views. LiDAR measures distance with laser pulses and works in the dark, while radar keeps working in rain and fog.

Every sensor is noisy. A camera blurs when the robot moves fast, an IMU drifts over time, and LiDAR returns are sparse on dark or shiny surfaces. No single sensor is enough, which is why robots fuse several of them.

Sensor fusion combines measurements so each one covers the others' weaknesses. A Kalman filter predicts the next state from a motion model, then corrects that prediction with each new measurement, weighting it by how much the filter trusts that sensor.

Calibration ties the sensors together. Intrinsic calibration describes a single camera (focal length, lens distortion); extrinsic calibration gives the rigid transform between two sensors, often written as a 4x4 homogeneous matrix.

The same transforms describe the arm itself. Denavit-Hartenberg parameters (link length, link twist, link offset and joint angle) give the transform from one joint frame to the next, and chaining them gives the pose of the gripper.

Modern systems add learned perception on top: neural networks detect objects, segment free space and estimate depth from a single image. They are powerful but need careful testing, because a detector that is right 99% of the time is still wrong once every hundred frames.`;

const ATTENTION = `How Transformers Pay Attention

Transformers read a whole sequence at once instead of word by word. The mechanism that makes this work is attention: every token looks at every other token and decides how much each one matters to it.

Each token produces three vectors: a query, a key and a value. A token's output is a weighted average of all the values, where the weights come from how well its query matches each key.

Instead of one attention pattern, the model learns several in parallel, called heads. One head might track which noun a pronoun refers to while another follows sentence structure. Their outputs are joined and mixed by a final projection.

Because attention ignores order, transformers add positional information to each token, either as fixed sine waves or as learned position embeddings, so the model can tell "dog bites man" from "man bites dog".

Attention costs grow with the square of the sequence length, which is why long documents are split into chunks or handled with sparse and sliding-window variants.

Vision transformers apply the same idea to images by cutting a picture into patches and treating each patch as a token. This is now common in robot perception, where one model can attend across camera, LiDAR and language inputs together.`;

const PLAN = `Study plan: week 4

Goal for the week: be able to explain how a robot knows where its own arm is and what it sees around it.

Monday: read the proprioception and exteroception sections and list one sensor for each.

Wednesday: work through a Kalman filter example by hand: one prediction step and one correction step.

Friday: present Denavit-Hartenberg parameters to the group, with the 4x4 transform for a two-link arm.

Stretch goal: compare a convolutional detector with a vision transformer on the same camera image.`;

type Doc = { id: string; title: string; paragraphs: string[] };

async function createDoc(user: User, title: string, text: string): Promise<Doc> {
  const { id } = await call<{ id: string }>("/api/rooms/text", { token: user.token, body: { title, text } });
  console.log(`✓ room "${title}" → /r/${id}`);
  return {
    id,
    title,
    paragraphs: text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
  };
}

// --- Ledger events, written as the users would from the room ---

const actorOf = (u: User): Actor => ({ id: u.id, name: u.name, color: u.color });
const base = (u: User, minutes: number) => ({ id: randomUUID(), at: minutesAgo(minutes), actor: actorOf(u) });

// A highlight or underline over `phrase` in paragraph `block` (text rooms number paragraphs b0, b1, …).
function mark(
  u: User,
  doc: Doc,
  block: number,
  phrase: string,
  kind: "highlight" | "underline",
  color: string,
  minutes: number,
) {
  const text = doc.paragraphs[block]!;
  const start = text.indexOf(phrase);
  if (start < 0) throw new Error(`"${phrase}" isn't in ${doc.title} b${block}`);
  return {
    ...base(u, minutes),
    type: "annot.add",
    annotation: {
      id: randomUUID(),
      doc: doc.id,
      block: `b${block}`,
      kind,
      start,
      end: start + phrase.length,
      quote: phrase,
      color,
      author: actorOf(u),
      at: minutesAgo(minutes),
    },
  };
}

function note(u: User, doc: Doc, block: number, body: string, minutes: number) {
  return {
    ...base(u, minutes),
    type: "annot.add",
    annotation: {
      id: randomUUID(),
      doc: doc.id,
      block: `b${block}`,
      kind: "note",
      x: 1.02,
      y: 0.1,
      body,
      color: "#facc15",
      author: actorOf(u),
      at: minutesAgo(minutes),
    },
  };
}

async function post(roomId: string, user: User, events: Record<string, unknown>[]) {
  const r = await call<{ accepted: string[]; rejected: { id: string | null; reason: string }[] }>(
    `/api/rooms/${roomId}/events`,
    { token: user.token, body: { events } },
  );
  if (r.rejected.length)
    console.warn(
      `  ! ${r.rejected.length} events refused:`,
      r.rejected.map((x) => x.reason),
    );
  return r;
}

// Studio makes real artifacts; the AI needs the documents indexed first, so retry for a while.
async function artifact(roomId: string, user: User, kind: string, title: string, sources: string[], minutes: number) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const body = await call<Record<string, unknown>>(`/api/rooms/${roomId}/artifacts`, {
        token: user.token,
        body: { kind, sources },
      });
      await post(roomId, user, [
        {
          ...base(user, minutes),
          type: "artifact.add",
          artifact: {
            id: randomUUID(),
            title,
            sources,
            author: actorOf(user),
            at: minutesAgo(minutes),
            preview: false,
            body,
          },
        },
      ]);
      console.log(`✓ Studio ${kind}`);
      return;
    } catch (err) {
      if (attempt === 11) console.warn(`  ! Studio ${kind} skipped: ${(err as Error).message}`);
      else await sleep(5000);
    }
  }
}

// A short huddle with a transcript tied to the passages, then real AI notes.
async function huddle(roomId: string, ada: User, ben: User, doc: Doc) {
  try {
    const { huddle: h } = await call<{ huddle: { id: string } }>(`/api/rooms/${roomId}/huddles`, {
      token: ada.token,
      body: { audience: "all", name: ada.name },
    });
    await call(`/api/rooms/${roomId}/huddles/${h.id}/join`, { token: ben.token, body: { name: ben.name } });
    const lines: [User, string, number][] = [
      [ada, "Let's go through the sensors section before Friday's presentation.", 2],
      [ben, "Proprioception is the robot sensing itself, so encoders, torque sensors and the IMU.", 2],
      [ada, "Right, and the IMU drifts over time, which is why we need sensor fusion.", 4],
      [ben, "I'll prepare the Kalman filter example: one prediction step and one correction step.", 5],
      [ada, "Great. I'll take the Denavit-Hartenberg slide with the four by four transform.", 7],
      [ben, "Open question: should we also compare LiDAR and stereo cameras for depth?", 3],
      [ada, "Let's decide that on Wednesday. Action items are clear, thanks Ben.", 3],
    ];
    const t0 = Date.now() - 60_000;
    for (const [i, [who, text, block]] of lines.entries()) {
      const at = new Date(t0 + i * 8000).toISOString();
      await call(`/api/rooms/${roomId}/huddles/${h.id}/segments`, {
        token: who.token,
        body: {
          segments: [
            {
              id: `s_${randomUUID().replace(/-/g, "")}`,
              text,
              start_at: at,
              end_at: new Date(t0 + i * 8000 + 6000).toISOString(),
              focus: { doc: doc.id, block: `b${block}` },
            },
          ],
        },
      });
    }
    await call(`/api/rooms/${roomId}/huddles/${h.id}/end`, { token: ada.token, body: {} });
    await call(`/api/rooms/${roomId}/huddles/${h.id}/notes`, { token: ada.token, body: {} });
    console.log("✓ huddle with transcript (AI notes are being written)");
  } catch (err) {
    console.warn(`  ! huddle skipped: ${(err as Error).message}`);
  }
}

async function main() {
  console.log(`Seeding demo data through ${API}`);
  const [ada, ben] = await Promise.all(DEMO_ACCOUNTS.slice(0, 2).map(ensureAccount));
  if (!ada || !ben) throw new Error("Two demo accounts are needed");

  // They follow each other, so People, mentions and the dashboard have someone in them.
  await call(`/api/users/${ben.id}/follow`, { token: ada.token, body: {} }).catch(() => {});
  await call(`/api/users/${ada.id}/follow`, { token: ben.token, body: {} }).catch(() => {});

  const { rooms } = await call<{ rooms: { id: string; title: string | null }[] }>("/api/me/rooms?limit=100", {
    token: ada.token,
  });
  const existing = rooms.find((r) => r.title === DEMO_ROOM_TITLE);
  if (existing) {
    console.log(`Demo room already there: /r/${existing.id} (nothing else to do)`);
    return;
  }

  const perception = await createDoc(ada, DEMO_ROOM_TITLE, PERCEPTION);
  const attention = await createDoc(ada, "How Transformers Pay Attention", ATTENTION);
  const plan = await createDoc(ada, "Study plan: week 4", PLAN);
  const room = perception.id;

  // A group on Ada's dashboard holding the room.
  const { groups } = await call<{ groups: { id: string; name: string }[] }>("/api/groups", { token: ada.token });
  const group =
    groups.find((g) => g.name === "Hackathon reading club") ??
    (await call<{ id: string }>("/api/groups", {
      token: ada.token,
      body: { name: "Hackathon reading club", color: "#2f5bff" },
    }).catch(() => null));
  if (group) await call(`/api/rooms/${room}`, { method: "PATCH", token: ada.token, body: { group_id: group.id } });

  await call(`/api/rooms/${room}/join`, { token: ben.token, body: {} });
  // Attached on the server (so AI chat and Studio can read them) and shown in the room by doc.add below.
  for (const d of [attention, plan]) {
    await call(`/api/rooms/${room}/sources`, { token: ada.token, body: { source_room_id: d.id } });
  }

  const docRef = (d: Doc) => ({ id: d.id, kind: "link", title: d.title, source_url: null, format: null });
  const chatHello = randomUUID();
  const chatPlan = randomUUID();

  await post(room, ada, [
    { ...base(ada, 180), type: "doc.add", doc: docRef(attention) },
    { ...base(ada, 179), type: "doc.add", doc: docRef(plan) },
    mark(ada, perception, 2, "Proprioception means self-sensing", "highlight", "#facc15", 170),
    mark(ada, perception, 5, "Kalman filter predicts the next state from a motion model", "highlight", "#4ade80", 165),
    mark(ada, perception, 7, "Denavit-Hartenberg parameters", "underline", "#2f5bff", 160),
    note(ada, perception, 4, `@${ben.name} this is why the IMU alone isn't enough. Can you explain it on Friday?`, 158),
    {
      ...base(ada, 150),
      type: "chat",
      message: {
        id: chatHello,
        text: "Welcome! Start with the sensors section, then the attention notes.",
        author: actorOf(ada),
        at: minutesAgo(150),
      },
    },
    {
      ...base(ada, 140),
      type: "notebook.add",
      entry: {
        id: randomUUID(),
        kind: "text",
        text: "Presentation on Friday: Ada takes DH parameters, Ben takes the Kalman filter.",
        quote: null,
        image: null,
        author: actorOf(ada),
        at: minutesAgo(140),
      },
    },
  ]);

  await post(room, ben, [
    mark(ben, perception, 3, "LiDAR measures distance with laser pulses", "highlight", "#f472b6", 120),
    mark(ben, attention, 2, "a weighted average of all the values", "highlight", "#facc15", 115),
    note(ben, attention, 3, "Each head learns a different pattern, a bit like fusing several sensors.", 112),
    { ...base(ben, 110), type: "chat.react", message_id: chatHello, emoji: "👍" },
    {
      ...base(ben, 108),
      type: "chat",
      message: {
        id: chatPlan,
        text: `@${ada.name} on it. I'll write up the Kalman filter example in the notebook tonight.`,
        author: actorOf(ben),
        at: minutesAgo(108),
        reply_to: chatHello,
      },
    },
    {
      ...base(ben, 100),
      type: "notebook.add",
      entry: {
        id: randomUUID(),
        kind: "quote",
        text: "The core idea for my slide.",
        quote: {
          doc: perception.id,
          block: "b5",
          text: "A Kalman filter predicts the next state from a motion model, then corrects that prediction with each new measurement",
        },
        image: null,
        author: actorOf(ben),
        at: minutesAgo(100),
      },
    },
  ]);
  await post(room, ada, [
    { ...base(ada, 95), type: "chat.react", message_id: chatPlan, emoji: "🔥" },
    {
      ...base(ada, 90),
      type: "chat",
      message: {
        id: randomUUID(),
        text: "Studio has a mind map and a quiz for both readings now 🎉",
        author: actorOf(ada),
        at: minutesAgo(90),
      },
    },
  ]);
  console.log("✓ highlights, comments, discussion and notebook");

  const sources = [perception.id, attention.id];
  await artifact(room, ada, "mindmap", "Mind map: perception and attention", sources, 85);
  await artifact(room, ada, "quiz", "Quiz: robot perception", [perception.id], 80);
  await artifact(room, ben, "flashcards", "Flashcards: transformers", [attention.id], 75);

  await huddle(room, ada, ben, perception);

  // A second, quieter room so the dashboard has more than one.
  await createDoc(
    ben,
    "Reading list for the weekend",
    "Reading list for the weekend\n\nAttention Is All You Need (Vaswani et al., 2017).\n\nProbabilistic Robotics, chapter 3: the Kalman filter.\n\nA survey of LiDAR and camera fusion for autonomous driving.",
  );

  console.log(`\nDone. Sign in as ${ada.email} or ${ben.email} (password ${ada.password}).`);
  console.log(`Demo room: /r/${room}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
