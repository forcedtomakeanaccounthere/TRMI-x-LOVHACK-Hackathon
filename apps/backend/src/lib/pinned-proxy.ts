import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { connect, isIP, type AddressInfo, type Socket } from "node:net";
import { isPrivateHost } from "./extract";

// The headless browser's only way out (see scraper-browser.ts). Checking a hostname and then letting
// Chromium resolve it again leaves a gap: the name can resolve to a public address for the check and
// to an internal one for the connection (DNS rebinding). Here the proxy does the lookup, rejects
// private addresses, and connects to the very address it checked, so Chromium never resolves a name.
//
// It listens on loopback with random credentials for one browser launch, so other local processes
// can't use it as an open proxy.

export type PinnedProxy = {
  server: string;
  username: string;
  password: string;
  close: () => Promise<void>;
};

// The address to connect to for `host`, or an error when it is, or resolves to, a private one.
export async function resolvePublicAddress(host: string): Promise<string> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (!bare || isPrivateHost(bare)) throw new Error(`blocked host ${host}`);
  if (isIP(bare)) return bare;
  const addresses = await lookup(bare, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateHost(address))) {
    throw new Error(`blocked host ${host}`);
  }
  return addresses[0]!.address;
}

// An upstream connection idle this long is dropped, so a server that never replies can't hold it.
export const UPSTREAM_IDLE_MS = 20_000;

export async function startPinnedProxy({ idleMs = UPSTREAM_IDLE_MS } = {}): Promise<PinnedProxy> {
  const username = "u" + randomBytes(8).toString("hex");
  const password = randomBytes(16).toString("hex");
  const expected = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  const authorized = (req: IncomingMessage) => req.headers["proxy-authorization"] === expected;

  // Every socket, browser-facing or upstream, is tracked so close() can destroy it; one opened
  // after close() (a DNS lookup that finished late) is destroyed at once.
  const sockets = new Set<Socket>();
  let closed = false;
  const track = (socket: Socket) => {
    if (closed) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };

  const server = createServer(async (req, res) => {
    // Plain http: the request line carries the absolute URL.
    if (!authorized(req)) {
      res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="scraper"' }).end();
      return;
    }
    let target: URL;
    try {
      target = new URL(req.url ?? "");
      if (target.protocol !== "http:") throw new Error("not http");
    } catch {
      res.writeHead(400).end();
      return;
    }
    let address: string;
    try {
      address = await resolvePublicAddress(target.hostname);
    } catch {
      res.writeHead(403).end();
      return;
    }
    if (closed || res.destroyed) return; // the lookup finished after shutdown or a disconnect
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = httpRequest(
      {
        host: address,
        port: Number(target.port) || 80,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
        setHost: false,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("socket", track);
    upstream.setTimeout(idleMs, () => upstream.destroy(new Error("upstream idle")));
    upstream.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    // The browser went away (page closed, Chromium shut down): drop the upstream request too.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });

  // https and wss: CONNECT host:port, then a raw tunnel to the checked address.
  server.on("connect", async (req: IncomingMessage, client: Socket, head: Buffer) => {
    track(client);
    client.on("error", () => client.destroy());
    if (!authorized(req)) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="scraper"\r\n\r\n');
      return;
    }
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url ?? "");
    if (!match) {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    let address: string;
    try {
      address = await resolvePublicAddress(match[1]!);
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    if (closed || client.destroyed) return; // the lookup finished after shutdown or a disconnect
    const upstream = connect(Number(match[2]), address, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.setTimeout(idleMs, () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    upstream.on("close", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });

  server.on("connection", track);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    server: `http://127.0.0.1:${port}`,
    username,
    password,
    close: () =>
      new Promise<void>((resolve) => {
        closed = true;
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
