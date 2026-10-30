import { Readability } from "@mozilla/readability";
import DOMPurify from "isomorphic-dompurify";
import { JSDOM } from "jsdom";
import { HttpError } from "../middleware/error";

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure";
const UNREADABLE = "We couldn't read this page. Try pasting the text instead.";

const PRIVATE_HOST = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
];

export function isPrivateHost(hostname: string) {
  return PRIVATE_HOST.some((re) => re.test(hostname));
}

export async function extractArticle(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol) || isPrivateHost(url.hostname)) {
    throw new HttpError(400, "Invalid URL");
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (LinkRoom reader)" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(422, UNREADABLE);
  }

  const dom = new JSDOM(await res.text(), { url: url.href });
  const article = new Readability(dom.window.document).parse();
  if (!article?.content) throw new HttpError(422, UNREADABLE);

  return {
    title: article.title ?? url.hostname,
    html: addBlockIds(DOMPurify.sanitize(article.content)),
  };
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
  let i = 0;
  document.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.setAttribute("data-block", `b${i++}`));
  return document.body.innerHTML;
}
