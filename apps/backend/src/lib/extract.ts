import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import DOMPurify from "isomorphic-dompurify";
import { JSDOM } from "jsdom";
import { HttpError } from "../middleware/error";
import { scrapeWithPlaywright } from "./scraper-browser";

// A table is one block: its rows and cells are not, so highlights and citations point at the table.
const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, table";
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

// BlockList also matches IPv4-mapped IPv6 (::ffff:7f00:1) against the IPv4 rules.
const PRIVATE_IPS = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  PRIVATE_IPS.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 96], // ::, ::1 and IPv4-compatible addresses
  ["64:ff9b::", 96], // NAT64, wraps an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
] as const) {
  PRIVATE_IPS.addSubnet(net, prefix, "ipv6");
}

export function isPrivateHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  if (family === 4) return PRIVATE_IPS.check(host, "ipv4");
  if (family === 6) return PRIVATE_IPS.check(host, "ipv6");
  return /^localhost$|\.localhost$/i.test(host);
}

// Rejects non-http(s) URLs and hosts that are, or resolve to, a private address (SSRF).
export async function assertPublicUrl(url: URL, signal?: AbortSignal) {
  if (!["http:", "https:"].includes(url.protocol) || isPrivateHost(url.hostname)) {
    throw new HttpError(400, "Invalid URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return;

  let addresses: { address: string }[];
  try {
    addresses = await withDeadline(lookup(hostname, { all: true }), signal);
  } catch {
    throw new HttpError(422, "We couldn't find that website. Check the link and try again.");
  }
  if (addresses.some(({ address }) => isPrivateHost(address))) throw new HttpError(400, "Invalid URL");
}

// dns.lookup takes no AbortSignal, so race it against the request's deadline.
function withDeadline<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// Follows redirects by hand so every hop goes through assertPublicUrl.
// One deadline covers DNS, every hop and reading the body.
async function fetchPage(start: URL) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("timed out")), FETCH_TIMEOUT_MS);
  try {
    return await followRedirects(start, deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function followRedirects(start: URL, signal: AbortSignal) {
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url, signal);

    let res: Response;
    try {
      res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "manual", signal });
    } catch {
      throw new HttpError(422, UNREADABLE);
    }

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await discardBody(res);
      try {
        url = new URL(location, url);
      } catch {
        throw new HttpError(422, UNREADABLE);
      }
      continue;
    }

    if (!res.ok) {
      await discardBody(res);
      throw new HttpError(422, UNREADABLE);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      await discardBody(res);
      throw new HttpError(422, "That link isn't a web page. Drop PDFs in directly, or paste the text instead.");
    }

    return { url, html: await readLimited(res) };
  }

  throw new HttpError(422, UNREADABLE);
}

// Frees the connection. A body that already errored (connection dropped mid-response) rejects
// on cancel; that must not replace the friendly error the caller is about to throw.
async function discardBody(res: Response) {
  await res.body?.cancel().catch(() => {});
}

async function readLimited(res: Response) {
  const tooLarge = () => new HttpError(422, "This page is too large to read. Try pasting the text instead.");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_PAGE_BYTES) {
    await discardBody(res);
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
        await reader.cancel().catch(() => {});
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

// Sites that can't be read from a link, and what to do instead. Checked against the link that was
// pasted, so the hint still shows when the site redirects to a login page.
const HOST_HINTS: { hosts: RegExp; paths?: RegExp; message: string }[] = [
  {
    hosts: /(^|\.)(notion\.so|notion\.site)$/,
    message:
      "Notion pages load with JavaScript, so we can't read them from a link. In Notion, use ••• → Export " +
      "(PDF or Markdown) and upload the file instead.",
  },
  {
    hosts: /^docs\.google\.com$/,
    paths: /^\/presentation\//,
    message: "Google Slides can't be read from a link. Use File → Download → PowerPoint (.pptx) and upload the file.",
  },
  {
    hosts: /^docs\.google\.com$/,
    paths: /^\/spreadsheets\//,
    message: "Google Sheets can't be read from a link. Copy the cells and paste them as text instead.",
  },
  {
    hosts: /^docs\.google\.com$/,
    message: "Google Docs can't be read from a link. Use File → Download → Microsoft Word (.docx) and upload the file.",
  },
  {
    hosts: /^drive\.google\.com$/,
    message: "Google Drive files can't be read from a link. Download the file and upload it here.",
  },
  {
    hosts: /(^|\.)(twitter\.com|x\.com|linkedin\.com|instagram\.com|facebook\.com|threads\.net)$/,
    message: "This site needs a login to show posts, so we can't read it. Copy the text and paste it instead.",
  },
  {
    hosts: /(^|\.)(youtube\.com|youtu\.be)$/,
    message: "Video links can't be read as a page yet. Paste the video's transcript as text instead.",
  },
];

/** A friendlier 422 message for sites we know can't be read from a link, or null. */
export function hostHint(url: URL) {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return HOST_HINTS.find((hint) => hint.hosts.test(host) && (!hint.paths || hint.paths.test(url.pathname)))?.message ?? null;
}

export async function extractArticle(rawUrl: string) {
  let start: URL;
  try {
    start = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "Invalid URL");
  }

  try {
    return await readArticle(start);
  } catch (err) {
    // A 400 (bad or private URL) stays as it is: only "couldn't read it" gets the site's own advice.
    const hint = err instanceof HttpError && err.status === 422 ? hostHint(start) : null;
    if (hint) throw new HttpError(422, hint);
    throw err;
  }
}

async function readArticle(start: URL) {
  let url = start;
  let html = "";
  let usedPlaywright = false;

  try {
    const page = await fetchPage(start);
    url = page.url;
    html = page.html;
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) throw err;
    try {
      const pw = await scrapeWithPlaywright(start);
      url = new URL(pw.finalUrl);
      html = pw.html;
      usedPlaywright = true;
    } catch {
      throw err;
    }
  }

  let dom = new JSDOM(html, { url: url.href });
  let article = new Readability(dom.window.document).parse();

  // If standard Readability failed on an SPA / dynamic page, invoke Playwright fallback
  if ((!article?.content || (article.textContent ?? "").trim().length < MIN_TEXT_CHARS) && !usedPlaywright) {
    try {
      const pw = await scrapeWithPlaywright(start);
      url = new URL(pw.finalUrl);
      html = pw.html;
      dom = new JSDOM(html, { url: url.href });
      article = new Readability(dom.window.document).parse();
    } catch {
      // Keep original article result if Playwright also failed
    }
  }

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
// `images: false` drops every image, for sources whose images we can't serve (an uploaded DOCX).
export function cleanArticle(html: string, baseUrl: string, { images = true }: { images?: boolean } = {}) {
  const safe = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "select", "textarea", "iframe", "object", "embed"],
    // Page classes and inline styles could pick up our own CSS or overlay the room UI.
    FORBID_ATTR: ["style", "class"],
  });
  const { document } = new JSDOM(`<body>${safe}</body>`, { url: baseUrl }).window;

  // Links open in a new tab so following one doesn't take the reader out of the room.
  // In-page anchors (footnotes, "jump to") stay as they are.
  for (const a of document.querySelectorAll("a[href]")) {
    const raw = a.getAttribute("href") ?? "";
    if (raw.startsWith("#")) continue;
    const href = absolute(raw, baseUrl);
    if (href && /^(https?|mailto):/i.test(href)) {
      a.setAttribute("href", href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer nofollow");
    } else {
      a.removeAttribute("href");
    }
  }

  if (!images) for (const el of document.querySelectorAll("img, picture")) el.remove();

  for (const el of document.querySelectorAll("img, source, video, audio")) {
    const src = absolute(el.getAttribute("src"), baseUrl);
    if (src) el.setAttribute("src", src);
    else el.removeAttribute("src");

    const srcset = el.getAttribute("srcset");
    if (srcset) {
      el.setAttribute(
        "srcset",
        parseSrcset(srcset)
          .map(({ url, descriptor }) => [absolute(url, baseUrl), descriptor].filter(Boolean).join(" "))
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

// Splits a srcset into candidates. A URL may itself contain commas (a,b.png 1x), so a comma
// only separates candidates after a descriptor or at the very end of a URL, as in the HTML spec.
export function parseSrcset(srcset: string) {
  const candidates: { url: string; descriptor: string }[] = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i]!)) i++;
    if (i >= srcset.length) break;

    let start = i;
    while (i < srcset.length && !/\s/.test(srcset[i]!)) i++;
    let url = srcset.slice(start, i);
    let descriptor = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      start = i;
      while (i < srcset.length && srcset[i] !== ",") i++;
      descriptor = srcset.slice(start, i).trim();
    }
    if (url) candidates.push({ url, descriptor });
  }
  return candidates;
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

// Elements that start a new paragraph in the plain text, marked as blocks or not (tables, lists, divs).
const PARAGRAPH_SELECTOR =
  "address, article, aside, blockquote, dd, details, div, dl, dt, figcaption, figure, footer, h1, h2, h3, " +
  "h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, summary, table, tr, ul";

// Plain text of a room's HTML for the AI, in document order: a blank line between paragraphs, a line
// break for <br>, a space between table cells, entities decoded and whitespace squeezed. Text outside
// the marked blocks (a table, say) is kept, and nested blocks are read once.
export function htmlToText(html: string) {
  // Markers instead of real newlines, since newlines in the source are just whitespace. Private-use
  // characters, so no real text contains them.
  const PARAGRAPH = "\uE000";
  const LINE = "\uE001";
  const { document } = new JSDOM(`<body>${html.replace(/[\uE000\uE001]/g, " ")}</body>`).window;
  const marker = (text: string) => document.createTextNode(text);
  for (const br of document.body.querySelectorAll("br")) br.replaceWith(marker(LINE));
  for (const cell of document.body.querySelectorAll("td, th")) cell.append(marker(" "));
  for (const el of document.body.querySelectorAll(PARAGRAPH_SELECTOR)) {
    el.before(marker(PARAGRAPH));
    el.after(marker(PARAGRAPH));
  }
  const squeeze = (text: string, separator: string, join: string, each: (part: string) => string) =>
    text.split(separator).map(each).filter(Boolean).join(join);
  return squeeze(document.body.textContent ?? "", PARAGRAPH, "\n\n", (paragraph) =>
    squeeze(paragraph, LINE, "\n", (line) => line.replace(/\s+/g, " ").trim()),
  );
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
