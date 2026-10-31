import { describe, expect, it } from "vitest";
import { parsePastedTranscript, summaryToDocHtml, transcriptToHtml, videoIdOf } from "../../src/lib/youtube";

const ID = "dQw4w9WgXcQ";

describe("videoIdOf", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?feature=share&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}&t=42s`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ])("reads %s", (url) => expect(videoIdOf(url)).toBe(ID));

  it.each([
    "not a url",
    `https://evil.test/watch?v=${ID}`,
    `https://www.youtube.com.evil.test/watch?v=${ID}`,
    `ftp://youtube.com/watch?v=${ID}`,
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/channel/UC123",
  ])("refuses %s with a 400", (url) => expect(() => videoIdOf(url)).toThrow(expect.objectContaining({ status: 400 })));
});

describe("parsePastedTranscript", () => {
  it("reads timestamps on their own line, or before the text", () => {
    expect(parsePastedTranscript("0:00\nHello there\n0:05\nsecond line\ncontinued\n1:02:33 the end")).toEqual([
      { start: 0, duration: null, text: "Hello there" },
      { start: 5, duration: null, text: "second line continued" },
      { start: 3753, duration: null, text: "the end" },
    ]);
  });

  it("keeps text with no timestamps as paragraphs without times", () => {
    expect(parsePastedTranscript("First para\nstill first\n\nSecond")).toEqual([
      { start: null, duration: null, text: "First para still first" },
      { start: null, duration: null, text: "Second" },
    ]);
  });
});

describe("transcriptToHtml", () => {
  const seg = (start: number, text: string, duration = 5) => ({ start, duration, text });

  it("joins segments into t{n} paragraphs with their time range, and closes one at 90 s", () => {
    const segments = Array.from({ length: 30 }, (_, i) => seg(i * 5, `word${i}`));
    const { html, durationSec } = transcriptToHtml(segments);
    expect(html.startsWith('<p data-block="t0" data-start="0" data-end="90">word0 word1')).toBe(true);
    expect(html).toContain('<p data-block="t1" data-start="90" data-end="150">word18');
    expect(durationSec).toBe(150);
  });

  it("closes a paragraph at a sentence end after 45 s", () => {
    const { html } = transcriptToHtml([seg(0, "Intro.", 46), seg(46, "Next part")]);
    expect(html).toBe(
      '<p data-block="t0" data-start="0" data-end="46">Intro.</p><p data-block="t1" data-start="46" data-end="51">Next part</p>',
    );
  });

  it("sets transcript text as text, never markup", () => {
    expect(transcriptToHtml([seg(0, "<script>alert(1)</script> & co")]).html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; co",
    );
  });

  it("leaves out times a pasted transcript doesn't have", () => {
    const { html, durationSec } = transcriptToHtml([{ start: null, duration: null, text: "No times" }]);
    expect(html).toBe('<p data-block="t0">No times</p>');
    expect(durationSec).toBeNull();
  });
});

describe("summaryToDocHtml", () => {
  it("writes the doc as b{n} blocks that point at the transcript blocks they come from", () => {
    const html = summaryToDocHtml({
      overview: "A talk about <attention>.",
      sections: [{ heading: "Attention", points: [{ text: "Point one", source_blocks: ["t3", "t4", "b9"] }] }],
      key_terms: [{ term: "Token", meaning: "a piece of text", source_blocks: ["t7"] }],
    });
    expect(html).toBe(
      '<p data-block="b0">A talk about &lt;attention&gt;.</p>' +
        '<h2 data-block="b1">Attention</h2>' +
        '<p data-block="b2" data-source="t3,t4">Point one</p>' +
        '<h2 data-block="b3">Key terms</h2>' +
        '<ul><li data-block="b4" data-source="t7">Token: a piece of text</li></ul>',
    );
  });
});
