import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import DOMPurify from "isomorphic-dompurify";
import { JSDOM } from "jsdom";
import { HttpError } from "../middleware/error";

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure";
const UNREADABLE = "We couldn't read this page. Try pasting the text instead.";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
// Below this much article text the page is usually a JS-only shell or a paywall stub.
const MIN_TEXT_CHARS = 200;
const MAX_TITLE_CHARS = 300;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const PRIVATE_HOST = [
  /^localhost$/i,
  /\.localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT 100.64.0.0/10
  /^0\./,
  /^\[?::1?\]?$/, // ::1 and ::
  /^\[?f[cd][0-9a-f]{2}:/i, // unique local fc00::/7
  /^\[?fe[89ab][0-9a-f]:/i, // link-local fe80::/10
];

export function isPrivateHost(hostname: string) {
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) is checked as the IPv4 address it wraps.
  const mapped = /^\[?::ffff:(\d+\.\d+\.\d+\.\d+)\]?$/i.exec(hostname);
  const host = mapped?.[1] ?? hostname;
  return PRIVATE_HOST.some((re) => re.test(host));
}

// Rejects non-http(s) URLs and hosts that are, or resolve to, a private address (SSRF).
export async function assertPublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || isPrivateHost(url.hostname)) {
    throw new HttpError(400, "Invalid URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new HttpError(422, "We couldn't find that website. Check the link and try again.");
  }
  if (addresses.some(({ address }) => isPrivateHost(address))) throw new HttpError(400, "Invalid URL");
}

// Follows redirects by hand so every hop goes through assertPublicUrl.
async function fetchPage(start: URL) {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);

    let res: Response;
    try {
      res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "manual", signal });
    } catch {
      throw new HttpError(422, UNREADABLE);
    }

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }

    if (!res.ok) throw new HttpError(422, UNREADABLE);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      await res.body?.cancel();
      throw new HttpError(422, "That link isn't a web page. Drop PDFs in directly, or paste the text instead.");
    }

    return { url, html: await readLimited(res) };
  }

  throw new HttpError(422, UNREADABLE);
}

async function readLimited(res: Response) {
  const tooLarge = () => new HttpError(422, "This page is too large to read. Try pasting the text instead.");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_PAGE_BYTES) {
    await res.body?.cancel();
    throw tooLarge();
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, UNREADABLE);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function extractArticle(rawUrl: string) {
  let start: URL;
  try {
    start = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "Invalid URL");
  }

  const { url, html } = await fetchPage(start);
  const dom = new JSDOM(html, { url: url.href });
  const article = new Readability(dom.window.document).parse();
  if (!article?.content || (article.textContent ?? "").trim().length < MIN_TEXT_CHARS) {
    throw new HttpError(422, UNREADABLE);
  }

  return {
    url: url.href,
    title: (article.title?.trim() || url.hostname).slice(0, MAX_TITLE_CHARS),
    html: cleanArticle(article.content, url.href),
  };
}

// Sanitizes extracted HTML, fixes its links and images, and adds block IDs, in one DOM pass.
export function cleanArticle(html: string, baseUrl: string) {
  const safe = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "select", "textarea", "iframe", "object", "embed"],
    // Page classes and inline styles could pick up our own CSS or overlay the room UI.
    FORBID_ATTR: ["style", "class", "id"],
  });
  const { document } = new JSDOM(`<body>${safe}</body>`, { url: baseUrl }).window;

  for (const a of document.querySelectorAll("a")) {
    const href = absolute(a.getAttribute("href"), baseUrl);
    if (href && /^(https?|mailto):/i.test(href)) {
      a.setAttribute("href", href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer nofollow");
    } else {
      a.removeAttribute("href");
    }
  }

  for (const el of document.querySelectorAll("img, source, video, audio")) {
    const src = absolute(el.getAttribute("src"), baseUrl);
    if (src) el.setAttribute("src", src);
    else el.removeAttribute("src");

    const srcset = el.getAttribute("srcset");
    if (srcset) {
      el.setAttribute(
        "srcset",
        srcset
          .split(",")
          .map((entry) => {
            const [u, ...descriptor] = entry.trim().split(/\s+/);
            return [absolute(u, baseUrl), ...descriptor].filter(Boolean).join(" ");
          })
          .filter(Boolean)
          .join(", "),
      );
    }
    if (el.tagName === "IMG") {
      el.setAttribute("loading", "lazy");
      el.setAttribute("referrerpolicy", "no-referrer");
    }
  }

  numberBlocks(document);
  return document.body.innerHTML;
}

function absolute(value: string | null | undefined, baseUrl: string) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

export function textToHtml(text: string) {
  const { document } = new JSDOM("<body></body>").window;
  for (const para of text.split(/\n\s*\n/)) {
    if (!para.trim()) continue;
    const p = document.createElement("p");
    p.textContent = para.trim();
    document.body.appendChild(p);
  }
  return addBlockIds(document.body.innerHTML);
}

// Every block gets a stable id ("b0", "b1", ...) used to anchor cursors and highlights.
export function addBlockIds(html: string) {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  numberBlocks(document);
  return document.body.innerHTML;
}

function numberBlocks(document: Document) {
  let i = 0;
  document.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.setAttribute("data-block", `b${i++}`));
}
