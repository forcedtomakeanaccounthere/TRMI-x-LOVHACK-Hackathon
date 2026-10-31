import { afterEach, describe, expect, it, vi } from "vitest";
import { extractArticle } from "../../src/lib/extract";
import * as scraperBrowser from "../../src/lib/scraper-browser";
import { HttpError } from "../../src/middleware/error";

describe("Playwright Scraper Fallback (lib/extract.ts)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("falls back to Playwright when standard fetch yields unreadable or client-rendered HTML", async () => {
    // Mock scrapeWithPlaywright returning a rendered DOM with article text
    const sampleArticleHtml = `
      <html>
        <head><title>Dynamic Blog Post</title></head>
        <body>
          <main>
            <h1>Dynamic Blog Post</h1>
            <p>This is a rendered paragraph from a dynamic client-side SPA or blog that requires JavaScript to load.</p>
            <p>It contains more than two hundred characters of article content so that Mozilla Readability considers it a valid and complete article text for LinkRoom readers.</p>
          </main>
        </body>
      </html>
    `;

    vi.spyOn(scraperBrowser, "scrapeWithPlaywright").mockResolvedValue({
      html: sampleArticleHtml,
      title: "Dynamic Blog Post",
      finalUrl: "https://example.com/dynamic-blog",
    });

    // Mock global fetch to return an empty JS shell (< 200 chars)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                return { done: false, value: Buffer.from("<div id='root'>Loading...</div>") };
              },
              cancel: async () => {},
            };
          },
        },
      }),
    );

    const article = await extractArticle("https://example.com/dynamic-blog");

    expect(scraperBrowser.scrapeWithPlaywright).toHaveBeenCalled();
    expect(article.title).toBe("Dynamic Blog Post");
    expect(article.html).toContain("data-block=\"b");
    expect(article.html).toContain("This is a rendered paragraph");
  });

  it("blocks private IPs and local networks from being scraped via SSRF defense", async () => {
    await expect(scraperBrowser.scrapeWithPlaywright(new URL("http://127.0.0.1:8080"))).rejects.toThrow(HttpError);
    await expect(scraperBrowser.scrapeWithPlaywright(new URL("http://192.168.1.100"))).rejects.toThrow(HttpError);
  });
});
