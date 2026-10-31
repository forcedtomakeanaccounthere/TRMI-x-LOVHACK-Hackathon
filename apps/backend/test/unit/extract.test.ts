import { afterEach, describe, expect, it, vi } from "vitest";
import { addBlockIds, extractArticle, isPrivateHost, openLinksInNewTab, textToHtml } from "../../src/lib/extract";
import { HttpError } from "../../src/middleware/error";

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
  ])("blocks %s", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(["example.com", "en.wikipedia.org", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1"])(
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

describe("openLinksInNewTab", () => {
  it("opens links in a new tab without giving the page access to the room", () => {
    expect(openLinksInNewTab('<p><a href="https://example.com/a">a</a></p>')).toBe(
      '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">a</a></p>',
    );
  });

  it("leaves in-page anchors and anchors without href alone", () => {
    const html = '<a href="#notes">jump</a><a name="notes">notes</a>';
    expect(openLinksInNewTab(html)).toBe(html);
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const body = "LinkRoom turns any link into a shared reading room for a group. ".repeat(12);
  const page = `<html><head><title>Shared reading</title></head><body><article>
    <h1>Shared reading</h1>
    <p>${body}<a href="/wiki/Reading">relative link</a> and <a href="https://other.org/x">absolute link</a>.</p>
    <p>${body}<img src="images/room.png" alt="room"><script>alert(1)</script></p>
  </article></body></html>`;

  it("returns sanitized article HTML with absolute URLs, new-tab links and block ids", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page, { headers: { "Content-Type": "text/html" } })));

    const { title, html } = await extractArticle("https://example.com/blog/post");

    expect(title).toBe("Shared reading");
    expect(html).toContain('<a href="https://example.com/wiki/Reading" target="_blank" rel="noopener noreferrer">');
    expect(html).toContain('<a href="https://other.org/x" target="_blank" rel="noopener noreferrer">');
    expect(html).toContain('src="https://example.com/blog/images/room.png"');
    expect(html).toContain('data-block="b0"');
    expect(html).not.toContain("<script");
  });

  it.each(["ftp://example.com/file", "javascript:alert(1)", "http://localhost:4000", "http://192.168.0.10/admin"])(
    "rejects %s before fetching",
    async (url) => {
      await expect(extractArticle(url)).rejects.toMatchObject({ status: 400, message: "Invalid URL" });
      await expect(extractArticle(url)).rejects.toBeInstanceOf(HttpError);
    },
  );
});
