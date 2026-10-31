import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// DNS and the private-address rule are controlled here, so a "public" name can be pointed at the
// local test server, and a name can resolve to a private address (DNS rebinding).
const dns = vi.hoisted(() => ({ answers: new Map<string, string>() }));
const allowLoopback = vi.hoisted(() => ({ on: false }));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    const address = dns.answers.get(host);
    if (!address) throw new Error("ENOTFOUND");
    return [{ address, family: 4 }];
  }),
}));

vi.mock("../../src/lib/extract", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/extract")>();
  return {
    ...real,
    isPrivateHost: (host: string) => (allowLoopback.on && host === "127.0.0.1" ? false : real.isPrivateHost(host)),
  };
});

const { resolvePublicAddress, startPinnedProxy } = await import("../../src/lib/pinned-proxy");

let target: Server;
let targetPort: number;
let proxy: Awaited<ReturnType<typeof startPinnedProxy>>;
let auth: string;

beforeAll(async () => {
  target = createServer((req, res) => res.end(`reached ${req.headers.host} ${req.url}`));
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  targetPort = (target.address() as AddressInfo).port;
  proxy = await startPinnedProxy();
  auth = "Basic " + Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
});

afterAll(async () => {
  await proxy.close();
  target.close();
});

beforeEach(() => {
  dns.answers.clear();
  allowLoopback.on = false;
});

// Sends raw bytes to the proxy; resolves with the whole reply, or the first chunk for CONNECT.
function send(payload: string, firstChunk = false) {
  return new Promise<string>((resolve) => {
    const socket = connect(Number(new URL(proxy.server).port), "127.0.0.1", () => socket.write(payload));
    let out = "";
    socket.on("data", (chunk) => {
      out += chunk;
      if (firstChunk) {
        socket.destroy();
        resolve(out);
      }
    });
    socket.on("close", () => resolve(out));
  });
}

const get = (url: string, host: string, withAuth = true) =>
  send(
    `GET ${url} HTTP/1.1\r\nHost: ${host}\r\n` +
      (withAuth ? `Proxy-Authorization: ${auth}\r\n` : "") +
      "Connection: close\r\n\r\n",
  );
const tunnel = (hostPort: string) =>
  send(`CONNECT ${hostPort} HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`, true);
const status = (reply: string) => reply.split("\r\n")[0];

describe("resolvePublicAddress", () => {
  it("refuses private literals and names, and names that resolve to a private address", async () => {
    dns.answers.set("rebind.test", "10.0.0.7");
    for (const host of ["127.0.0.1", "[::1]", "10.1.2.3", "localhost", "rebind.test"]) {
      await expect(resolvePublicAddress(host)).rejects.toThrow(/blocked/);
    }
  });

  it("returns the checked address for a public name", async () => {
    dns.answers.set("public.test", "93.184.215.14");
    await expect(resolvePublicAddress("public.test")).resolves.toBe("93.184.215.14");
  });
});

describe("the pinned proxy", () => {
  it("asks for its credentials", async () => {
    expect(status(await get(`http://127.0.0.1:${targetPort}/`, "x", false))).toBe(
      "HTTP/1.1 407 Proxy Authentication Required",
    );
  });

  it("won't fetch or tunnel to a private address, however it is named", async () => {
    dns.answers.set("rebind.test", "127.0.0.1");
    for (const host of ["127.0.0.1", "localhost", "rebind.test"]) {
      const reply = await get(`http://${host}:${targetPort}/`, host);
      expect(status(reply)).toBe("HTTP/1.1 403 Forbidden");
      expect(reply).not.toContain("reached");
      expect(status(await tunnel(`${host}:${targetPort}`))).toBe("HTTP/1.1 403 Forbidden");
    }
    expect(status(await tunnel(`[::1]:${targetPort}`))).toBe("HTTP/1.1 403 Forbidden");
  });

  it("connects to the address it checked, keeping the Host and dropping its own credentials", async () => {
    allowLoopback.on = true; // stand-in: treat the test server's address as public
    dns.answers.set("public.test", "127.0.0.1");
    const reply = await get(`http://public.test:${targetPort}/page?q=1`, "public.test");
    expect(status(reply)).toBe("HTTP/1.1 200 OK");
    expect(reply).toContain("reached public.test /page?q=1");
  });

  it("tunnels CONNECT to the checked address", async () => {
    allowLoopback.on = true;
    dns.answers.set("public.test", "127.0.0.1");
    expect(status(await tunnel(`public.test:${targetPort}`))).toBe("HTTP/1.1 200 Connection Established");
  });

  it("refuses names it can't resolve", async () => {
    expect(status(await get("http://nowhere.test/", "nowhere.test"))).toBe("HTTP/1.1 403 Forbidden");
  });
});

describe("connections to a server that never replies", () => {
  // Counts the connections the proxy opens to it and notices when each one closes.
  async function hangingServer() {
    let open = 0;
    let opened = 0;
    const server = createServer(() => {}); // never responds
    server.on("connection", (socket) => {
      open++;
      opened++;
      socket.on("close", () => open--);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      port: (server.address() as AddressInfo).port,
      open: () => open,
      opened: () => opened,
      close: () => server.close(),
    };
  }

  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(check()).toBe(true);
  };

  async function startRequest(p: Awaited<ReturnType<typeof startPinnedProxy>>, port: number) {
    const creds = "Basic " + Buffer.from(`${p.username}:${p.password}`).toString("base64");
    const socket = connect(Number(new URL(p.server).port), "127.0.0.1", () =>
      socket.write(`GET http://public.test:${port}/ HTTP/1.1\r\nHost: public.test\r\nProxy-Authorization: ${creds}\r\n\r\n`),
    );
    socket.on("error", () => {});
    return socket;
  }

  beforeEach(() => {
    allowLoopback.on = true;
    dns.answers.set("public.test", "127.0.0.1");
  });

  it("drops the upstream request when the browser disconnects", async () => {
    const hang = await hangingServer();
    const p = await startPinnedProxy();
    const browser = await startRequest(p, hang.port);
    await waitFor(() => hang.open() === 1);

    browser.destroy();
    await waitFor(() => hang.open() === 0);
    await p.close();
    hang.close();
  });

  it("drops an idle upstream request", async () => {
    const hang = await hangingServer();
    const p = await startPinnedProxy({ idleMs: 50 });
    await startRequest(p, hang.port);
    await waitFor(() => hang.opened() === 1);
    await waitFor(() => hang.open() === 0);
    await p.close();
    hang.close();
  });

  it("closes upstream connections on shutdown, including tunnels", async () => {
    const hang = await hangingServer();
    const p = await startPinnedProxy();
    await startRequest(p, hang.port);
    const creds = "Basic " + Buffer.from(`${p.username}:${p.password}`).toString("base64");
    const tunnelSocket = connect(Number(new URL(p.server).port), "127.0.0.1", () =>
      tunnelSocket.write(`CONNECT public.test:${hang.port} HTTP/1.1\r\nProxy-Authorization: ${creds}\r\n\r\n`),
    );
    tunnelSocket.on("error", () => {});
    await waitFor(() => hang.open() === 2);

    await p.close();
    await waitFor(() => hang.open() === 0);
    hang.close();
  });
});
