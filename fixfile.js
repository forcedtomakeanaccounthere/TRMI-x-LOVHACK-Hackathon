const { execFileSync } = require('child_process');
const fs = require('fs');
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const ROOT = 'C:\\Users\\Arnav Ranjan\\trmi\\forcedtomakeanaccounthere.trmi-x-lovhack-hackathon\\.trmi\\worktrees\\arnav-greptile-fix';
const p = ROOT + '\\apps\\backend\\test\\unit\\rooms.test.ts';

let s;
try {
  s = execFileSync(GIT, ['show', 'origin/main:apps/backend/test/unit/rooms.test.ts'], { encoding: 'utf8', cwd: ROOT });
} catch (e) {
  fs.writeFileSync(__dirname + '\\fixerr.txt', 'GITERR ' + (e.stderr || e.message));
  process.exit(1);
}

const edits = [
  [
    `const moves: [from: string, to: string][] = [];
let moveError: Error | null = null;

function table(name: string) {
  const log = (calls[name] ??= []);
  const builder: Record<string, unknown> = {
    then: (resolve: (r: Result) => unknown) => resolve({ data: [], error: null, count: 0, ...results[name]?.shift() }),
  };
  for (const method of ["select", "eq", "neq", "or", "ilike", "order", "range", "limit", "maybeSingle", "single", "update", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      log.push([method, ...args]);
      return builder;
    };
  }
  return builder;
}`,
    `const moves: [from: string, to: string][] = [];
let moveError: Error | null = null;
// Set by a test to sequence awaited queries (a chain's log tells reads from updates) and to
// decide update results from tracked state instead of the queue.
let gate: ((log: Call[]) => Promise<void>) | null = null;
let onUpdate: ((log: Call[]) => Result) | null = null;

function table(name: string) {
  // `calls` is shared so existing assertions can read the call order; `log` is per-chain so a
  // concurrent request can't be mistaken for this one's update.
  const shared = (calls[name] ??= []);
  const log: Call[] = [];
  const builder: Record<string, unknown> = {
    then: async (resolve: (r: Result) => unknown) => {
      if (gate) await gate(log);
      if (onUpdate && log.some(([m]) => m === "update")) return resolve(onUpdate(log));
      resolve({ data: [], error: null, count: 0, ...results[name]?.shift() });
    },
  };
  for (const method of ["select", "eq", "neq", "or", "ilike", "order", "range", "limit", "maybeSingle", "single", "update", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      log.push([method, ...args]);
      shared.push([method, ...args]);
      return builder;
    };
  }
  return builder;
}`,
  ],
  [
    `  moves.length = 0;
  moveError = null;
  results.room_visits = [{ data: [] }];`,
    `  moves.length = 0;
  moveError = null;
  gate = null;
  onUpdate = null;
  results.room_visits = [{ data: [] }];`,
  ],
  [
    `  it("answers 400 for a missing or unknown status", async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: "paused" })).status).toBe(400);
  });
});`,
    `  it("undoes the delete move when its save loses the race", async () => {
    results.rooms = [{ data: { status: "running", pdf_path: "room0001.pdf" } }, { data: null }];

    expect((await patch({ status: "deleted" })).status).toBe(409);
    expect(moves).toEqual([
      ["pdfs", "pdfs-deleted"],
      ["pdfs-deleted", "pdfs"],
    ]);
  });

  it("moves nothing public when a restore and a delete overlap on a deleted room", async () => {
    // Both requests must read \`deleted\` before either saves — the gate holds the saves until
    // both reads are done — and each save rechecks the status it read against stored state,
    // like the database would. Whichever order the saves land in, a deleted room's PDF never
    // ends up stranded in the public bucket.
    const stored = { status: "deleted" };
    let readsDone = 0;
    let releaseSaves: () => void = () => {};
    const savesAllowed = new Promise<void>((r) => (releaseSaves = r));
    gate = async (log) => {
      if (log.some(([m]) => m === "update")) await savesAllowed;
      else if (++readsDone === 2) releaseSaves();
    };
    onUpdate = (log) => {
      const written = (log.find(([m]) => m === "update")![1] as { status: string }).status;
      const guard = (log.find(([m, ...a]) => m === "eq" && a[0] === "status") as [string, string, string] | undefined)?.[2];
      if (guard !== stored.status) return { data: null };
      stored.status = written;
      return { data: { id: "room0001", status: written } };
    };
    results.rooms = [
      { data: { status: "deleted", pdf_path: "room0001.pdf" } },
      { data: { status: "deleted", pdf_path: "room0001.pdf" } },
    ];

    const [restore, remove] = await Promise.all([patch({ status: "closed" }), patch({ status: "deleted" })]);
    expect(restore.status).toBe(200);
    expect(restore.body).toEqual({ id: "room0001", status: "closed" });
    if (remove.status === 200) expect(remove.body).toEqual({ id: "room0001", status: "deleted" });
    else expect(remove.status).toBe(409);
    expect(moves).toEqual([["pdfs-deleted", "pdfs"]]);
    expect(stored.status).toBe("closed");
    gate = null;
    onUpdate = null;
  });

  it("answers 400 for a missing or unknown status", async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: "paused" })).status).toBe(400);
  });
});`,
  ],
];

let ok = 0;
for (const [from, to] of edits) {
  if (!s.includes(from)) { fs.writeFileSync(__dirname + '\\fixerr.txt', 'MISS: ' + from.slice(0, 80)); process.exit(1); }
  s = s.replace(from, to);
  ok++;
}
fs.writeFileSync(p, s);
fs.writeFileSync(__dirname + '\\fixok.txt', 'applied ' + ok + '/' + edits.length + ' len=' + s.length);
