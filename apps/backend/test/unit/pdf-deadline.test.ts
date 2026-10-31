import { getDocumentProxy } from "unpdf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../../src/lib/pdf";

// pdf.js is replaced by controlled promises, so slow opens and slow pages can be timed with fake timers.
vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn() }));
const mockOpen = vi.mocked(getDocumentProxy);
type Doc = Awaited<ReturnType<typeof getDocumentProxy>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const page = (text: string) => ({ getTextContent: async () => ({ items: [{ str: text }] }) });
const never = () => new Promise<never>(() => {});

// A document whose pages come from `pages`; `null` is a page that never finishes loading.
function fakeDoc(pages: (string | null)[]) {
  return {
    numPages: pages.length,
    getPage: vi.fn((n: number) => (pages[n - 1] === null ? never() : Promise.resolve(page(pages[n - 1]!)))),
    destroy: vi.fn(async () => {}),
  };
}

const PDF = Buffer.from("%PDF-1.4");

beforeEach(() => {
  vi.useFakeTimers();
  mockOpen.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("extractPdfText deadline", () => {
  it("refuses a PDF that takes over 10 s to open, and frees it once it opens", async () => {
    const opening = deferred<Doc>();
    mockOpen.mockReturnValue(opening.promise);

    const result = extractPdfText(PDF).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(await Promise.race([result, "pending"])).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({
      status: 422,
      message: "This PDF took too long to open. Try a smaller file.",
    });

    // The late open must not leak the document.
    const doc = fakeDoc(["late"]);
    opening.resolve(doc as unknown as Doc);
    await vi.waitFor(() => expect(doc.destroy).toHaveBeenCalledOnce());
  });

  it("keeps the pages read before a page stalls, and frees the document", async () => {
    const doc = fakeDoc(["first", "second", null, "never reached"]);
    mockOpen.mockResolvedValue(doc as unknown as Doc);

    const result = extractPdfText(PDF);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await result).toBe("[Page 1] first\n\n[Page 2] second");
    expect(doc.getPage).not.toHaveBeenCalledWith(4);
    expect(doc.destroy).toHaveBeenCalledOnce();
  });

  it("returns null when the first page stalls", async () => {
    const doc = fakeDoc([null]);
    mockOpen.mockResolvedValue(doc as unknown as Doc);

    const result = extractPdfText(PDF);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await result).toBeNull();
    expect(doc.destroy).toHaveBeenCalledOnce();
  });

  it("refuses a password-protected PDF with its own message", async () => {
    mockOpen.mockRejectedValue(Object.assign(new Error("No password given"), { name: "PasswordException" }));

    await expect(extractPdfText(PDF)).rejects.toMatchObject({
      status: 422,
      message: "This PDF is password-protected. Remove the password and try again.",
    });
  });
});
