import { describe, expect, it } from "vitest";
import { addBlockIds, extractArticle, isPrivateHost, textToHtml } from "../../src/lib/extract";
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
