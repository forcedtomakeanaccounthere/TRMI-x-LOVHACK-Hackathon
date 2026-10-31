import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBlockIds,
  cleanArticle,
  extractArticle,
  isPrivateHost,
  parseSrcset,
  textToHtml,
} from "../../src/lib/extract";
import { HttpError } from "../../src/middleware/error";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const mockLookup = vi.mocked(lookup) as unknown as ReturnType<typeof vi.fn>;

describe("isPrivateHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "[::1]",
    "::",
    "app.localhost",
    "100.64.0.1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "[::ffff:10.0.0.1]",
    // URL parsing turns [::ffff:127.0.0.1] into this hex form.
    "[::ffff:7f00:1]",
    "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1",
  ])("blocks %s", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(["example.com", "en.wikipedia.org", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.128.0.1", "2001:4860::8888"])(
    "allows %s",
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    },
  );
});

describe("addBlockIds", () => {
  it("numbers block elements in document order", () => {
    const html = addBlockIds("<h1>T</h1><p>a</p><ul><li>x</li><li>y</li></ul><span>no</span><pre>c</pre>");
    expect(html).toBe(
      '<h1 data-block="b0">T</h1><p data-block="b1">a</p>' +
        '<ul><li data-block="b2">x</li><li data-block="b3">y</li></ul><span>no</span><pre data-block="b4">c</pre>',
    );
  });
});

describe("textToHtml", () => {
  it("splits paragraphs on blank lines and drops empty ones", () => {
    expect(textToHtml("one\nline two\n\n\n  \n\nthree")).toBe(
      '<p data-block="b0">one\nline two</p><p data-block="b1">three</p>',
    );
  });

  it("shows pasted HTML as plain text", () => {
    const html = textToHtml("<div>hi</div> & <script>alert(1)</script>");
    expect(html).toBe('<p data-block="b0">&lt;div&gt;hi&lt;/div&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html).not.toContain("<script");
  });
});

describe("extractArticle", () => {
  it.each(["ftp://example.com/file", "javascript:alert(1)", "http://localhost:4000", "http://192.168.0.10/admin"])(
    "rejects %s before fetching",
    async (url) => {
      await expect(extractArticle(url)).rejects.toMatchObject({ status: 400, message: "Invalid URL" });
      await expect(extractArticle(url)).rejects.toBeInstanceOf(HttpError);
    },
  );
});

const ARTICLE_TEXT = "Readable paragraph text that is long enough for Readability to keep. ".repeat(6);
const PAGE = `<!doctype html><html><head><title>Test article</title></head><body><article>
  <h1>Test article</h1>
  <p>${ARTICLE_TEXT}<a href="/wiki/Next">next</a> <a href="javascript:alert(1)">bad</a></p>
  <p>${ARTICLE_TEXT}<img src="img/a.png" srcset="img/a.png 1x, /img/b.png 2x"></p>
  <script>alert(1)</script>
</article></body></html>`;

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });
}

describe("extractArticle with a fetched page", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    mockLookup.mockResolvedValue([{ address: "93.184.215.14", family: 4 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    mockLookup.mockReset();
  });

  it("returns a clean, block-numbered article with absolute links", async () => {
    fetchMock.mockResolvedValue(htmlResponse(PAGE));
    const { url, title, html } = await extractArticle("https://example.com/post");

    expect(url).toBe("https://example.com/post");
    expect(title).toBe("Test article");
    expect(html).not.toContain("<script");
    expect(html).toContain('data-block="b0"');
    expect(html).toContain('href="https://example.com/wiki/Next" target="_blank" rel="noopener noreferrer nofollow"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('src="https://example.com/img/a.png"');
    expect(html).toContain('srcset="https://example.com/img/a.png 1x, https://example.com/img/b.png 2x"');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("resolves relative links and images against the page URL", async () => {
    const body = "LinkRoom turns any link into a shared reading room for a group. ".repeat(12);
    const page = `<html><head><title>Shared reading</title></head><body><article>
      <h1>Shared reading</h1>
      <p>${body}<a href="/wiki/Reading">relative link</a> and <a href="https://other.org/x">absolute link</a>.</p>
      <p>${body}<img src="images/room.png" alt="room"><script>alert(1)</script></p>
    </article></body></html>`;
    fetchMock.mockResolvedValue(htmlResponse(page));

    const { title, html } = await extractArticle("https://example.com/blog/post");

    expect(title).toBe("Shared reading");
    expect(html).toContain('<a href="https://example.com/wiki/Reading" target="_blank" rel="noopener noreferrer nofollow">');
    expect(html).toContain('<a href="https://other.org/x" target="_blank" rel="noopener noreferrer nofollow">');
    expect(html).toContain('src="https://example.com/blog/images/room.png"');
    expect(html).not.toContain("<script");
  });

  it("follows redirects and reports the final URL", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/final" } }))
      .mockResolvedValueOnce(htmlResponse(PAGE));
    const { url } = await extractArticle("http://example.com/start");
    expect(url).toBe("http://example.com/final");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect to a private address", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
    );
    await expect(extractArticle("https://example.com/")).rejects.toMatchObject({ status: 400, message: "Invalid URL" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a hostname that resolves to a private address", async () => {
    mockLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(extractArticle("https://evil.example/")).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["http://[::ffff:7f00:1]/", "http://[::ffff:127.0.0.1]/admin", "http://[64:ff9b::a9fe:a9fe]/"])(
    "refuses the IPv6 form of a private IPv4 address: %s",
    async (url) => {
      await expect(extractArticle(url)).rejects.toMatchObject({ status: 400, message: "Invalid URL" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("returns 422, not 500, for a redirect with a broken Location", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://[" } }));
    await expect(extractArticle("https://example.com/")).rejects.toMatchObject({ status: 422 });
  });

  it("returns 422 when DNS outlasts the request deadline", async () => {
    vi.useFakeTimers();
    try {
      mockLookup.mockReturnValue(new Promise(() => {}));
      const result = expect(extractArticle("https://slow-dns.example/")).rejects.toMatchObject({ status: 422 });
      await vi.advanceTimersByTimeAsync(10_001);
      await result;
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the body of an error response", async () => {
    const res = htmlResponse("gone", { status: 500 });
    const cancel = vi.spyOn(res.body!, "cancel");
    fetchMock.mockResolvedValue(res);
    await expect(extractArticle("https://example.com/")).rejects.toMatchObject({ status: 422 });
    expect(cancel).toHaveBeenCalled();
  });

  it("gives up after too many redirects", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/loop" } }));
    await expect(extractArticle("https://example.com/")).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["an unknown host", () => mockLookup.mockRejectedValue(new Error("ENOTFOUND"))],
    ["a network error", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
    ["an error status", () => fetchMock.mockResolvedValue(htmlResponse("gone", { status: 404 }))],
    ["a non-HTML response", () => fetchMock.mockResolvedValue(htmlResponse("{}", { headers: { "content-type": "application/json" } }))],
    ["a page that is too large", () => fetchMock.mockResolvedValue(htmlResponse("x".repeat(5 * 1024 * 1024 + 1)))],
    ["a JavaScript-only shell", () => fetchMock.mockResolvedValue(htmlResponse('<html><body><div id="root"></div><script src="/app.js"></script></body></html>'))],
  ])("returns 422 for %s", async (_name, arrange) => {
    arrange();
    await expect(extractArticle("https://example.com/")).rejects.toMatchObject({ status: 422 });
  });
});

describe("cleanArticle", () => {
  it("drops page styles and forms that could clash with the room UI", () => {
    const html = cleanArticle(
      '<p class="fixed inset-0" style="position:fixed">a</p><style>p{}</style><form><input></form>',
      "https://example.com/",
    );
    expect(html).toBe('<p data-block="b0">a</p>');
  });

  it("leaves in-page anchors and their targets working", () => {
    const html = '<p><a href="#notes">jump</a></p><p id="notes"><a name="n1">notes</a></p>';
    expect(cleanArticle(html, "https://example.com/post")).toBe(
      '<p data-block="b0"><a href="#notes">jump</a></p><p id="notes" data-block="b1"><a name="n1">notes</a></p>',
    );
  });

  it("keeps commas that are part of a srcset URL", () => {
    const html = cleanArticle('<img src="a.png" srcset="images/a,b.png 1x, /c.png 2x">', "https://example.com/blog/");
    expect(html).toContain('srcset="https://example.com/blog/images/a,b.png 1x, https://example.com/c.png 2x"');
  });
});

describe("parseSrcset", () => {
  it.each([
    ["a.png 1x, b.png 2x", [{ url: "a.png", descriptor: "1x" }, { url: "b.png", descriptor: "2x" }]],
    ["images/a,b.png 1x", [{ url: "images/a,b.png", descriptor: "1x" }]],
    ["a.png,b.png 2x", [{ url: "a.png,b.png", descriptor: "2x" }]],
    ["a.png, b.png", [{ url: "a.png", descriptor: "" }, { url: "b.png", descriptor: "" }]],
    ["  a.png 480w ,  ", [{ url: "a.png", descriptor: "480w" }]],
  ])("parses %j", (srcset, expected) => {
    expect(parseSrcset(srcset)).toEqual(expected);
  });
});
