import { chromium, type Browser } from "playwright";
import { assertPublicUrl } from "./extract";
import { HttpError } from "../middleware/error";

const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type PlaywrightScrapedPage = {
  html: string;
  title: string;
  finalUrl: string;
};

/**
 * Headless Playwright scraper fallback for dynamic or client-rendered pages
 * (e.g., Notion, Medium, Substack, dynamic SPAs, client-rendered blogs & research portals).
 *
 * Enforces strict DNS-aware SSRF defense on the initial URL, on all sub-requests/redirects,
 * and on the final destination URL.
 */
export async function scrapeWithPlaywright(
  targetUrl: URL,
  timeoutMs = DEFAULT_PLAYWRIGHT_TIMEOUT_MS,
): Promise<PlaywrightScrapedPage> {
  // 1. Initial SSRF check (validates protocol, hostname, and resolved IP addresses)
  await assertPublicUrl(targetUrl);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
      ],
    });

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 900 },
      javaScriptEnabled: true,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // Host validation cache so repeat assets (css, js, images) avoid redundant DNS lookups
    const validatedHosts = new Map<string, boolean>();

    const checkHostAllowed = async (url: URL): Promise<boolean> => {
      if (!["http:", "https:"].includes(url.protocol)) return false;
      const host = url.hostname.toLowerCase();
      if (validatedHosts.has(host)) return validatedHosts.get(host)!;

      try {
        await assertPublicUrl(url);
        validatedHosts.set(host, true);
        return true;
      } catch {
        validatedHosts.set(host, false);
        return false;
      }
    };

    // SSRF interceptor: abort any request attempting to route to private/internal IP ranges or DNS names
    await page.route("**/*", async (route) => {
      let reqUrl: URL;
      try {
        reqUrl = new URL(route.request().url());
      } catch {
        await route.abort("accessdenied");
        return;
      }

      if (!["http:", "https:"].includes(reqUrl.protocol)) {
        await route.abort("accessdenied");
        return;
      }

      const isAllowed = await checkHostAllowed(reqUrl);
      if (!isAllowed) {
        await route.abort("accessdenied");
      } else {
        await route.continue();
      }
    });

    // Navigate to page
    const response = await page.goto(targetUrl.href, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    if (!response) {
      throw new HttpError(422, "We couldn't read this page. Try pasting the text instead.");
    }

    const status = response.status();
    if (status >= 400) {
      throw new HttpError(status >= 500 ? 502 : 422, "We couldn't read this page. Try pasting the text instead.");
    }

    // Wait briefly for common client-rendered selectors if present (Notion, Medium, Substack, etc.)
    await Promise.race([
      page.waitForSelector(".notion-page-content, article, main, [role='main']", { timeout: 3000 }).catch(() => null),
      page.waitForLoadState("networkidle").catch(() => null),
      new Promise((res) => setTimeout(res, 2000)),
    ]);

    const finalHref = page.url();
    const finalUrl = new URL(finalHref);
    // 2. Strict DNS-aware verification on final destination
    await assertPublicUrl(finalUrl);

    const html = await page.content();
    const title = (await page.title()) || "";

    await context.close();
    return {
      html,
      title: title.trim().slice(0, 300),
      finalUrl: finalHref,
    };
  } catch (err: unknown) {
    if (err instanceof HttpError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Timeout") || msg.includes("timeout")) {
      throw new HttpError(422, "This page took too long to load. Try pasting the text instead.");
    }
    throw new HttpError(422, "We couldn't read this page. Try pasting the text instead.");
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
}
