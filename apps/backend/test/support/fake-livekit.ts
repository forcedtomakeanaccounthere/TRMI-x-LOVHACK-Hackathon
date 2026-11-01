import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for LiveKit Cloud / Twirp RoomService over real HTTP, for tests:
// answers ListParticipants, RemoveParticipant, UpdateParticipant, DeleteRoom,
// and records each call so tests can assert what was called.

export type FakeLiveKitCall = {
  method: string;
  path: string;
  body: Record<string, unknown>;
};

export type FakeLiveKitParticipant = {
  identity: string;
  name?: string;
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export async function startFakeLiveKit() {
  const calls: FakeLiveKitCall[] = [];
  const participants = new Map<string, FakeLiveKitParticipant[]>();

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? "/";
      const body = (await readJson(req)) as Record<string, unknown>;
      calls.push({ method: req.method ?? "POST", path, body });

      let reply: unknown = {};
      if (path.endsWith("ListParticipants")) {
        const room = String(body.room ?? "");
        reply = { participants: participants.get(room) ?? [] };
      } else if (path.endsWith("RemoveParticipant")) {
        const room = String(body.room ?? "");
        const identity = String(body.identity ?? "");
        const current = participants.get(room) ?? [];
        participants.set(room, current.filter((p) => p.identity !== identity));
        reply = {};
      } else if (path.endsWith("UpdateParticipant")) {
        reply = {};
      } else if (path.endsWith("DeleteRoom")) {
        const room = String(body.room ?? "");
        participants.delete(room);
        reply = {};
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    })().catch((err: unknown) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    participants,
    setParticipants: (room: string, list: FakeLiveKitParticipant[]) => {
      participants.set(room, list);
    },
    reset: () => {
      calls.length = 0;
      participants.clear();
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeLiveKit = Awaited<ReturnType<typeof startFakeLiveKit>>;
