// @mentions in chat messages and notes. Parsing lives here so the browser (highlighting,
// autocomplete), the backend and the tests all agree on what counts as a mention.

export type MentionPerson = { id: string; name: string };
export type Mention = MentionPerson;

// A name ends at whitespace, punctuation or the end of the text: "@Ana," and "@Ana" both match Ana,
// "@Anabel" doesn't.
const NAME_END = /[\s.,!?;:()[\]{}'"`’”—–-]/;
// "@" opens a mention at the start of the text or after whitespace or an opening bracket/quote,
// so "ana@example.com" is not one.
const MENTION_START = /[\s([{'"`‘“]/;

const opensMention = (text: string, i: number) => text[i] === "@" && (i === 0 || MENTION_START.test(text[i - 1]!));

// The person mentioned by the "@" at `i`, if any. Longest names win, so "@Ada Lovelace" isn't read
// as "@Ada" when both are in the room.
function mentionAt(text: string, lower: string, i: number, people: MentionPerson[]): MentionPerson | null {
  let best: MentionPerson | null = null;
  for (const person of people) {
    const name = person.name.trim();
    if (!name || (best && best.name.trim().length >= name.length)) continue;
    const end = i + 1 + name.length;
    if (lower.startsWith(name.toLowerCase(), i + 1) && (end >= text.length || NAME_END.test(text[end]!))) best = person;
  }
  return best;
}

// The people mentioned in `text`, in order of first mention, each once. Only names in `people`
// count: an "@word" that matches nobody is left alone.
export function parseMentions(text: string, people: MentionPerson[]): Mention[] {
  const found = new Map<string, Mention>();
  for (const segment of splitOnMentions(text, people)) {
    if (segment.person && !found.has(segment.person.id)) found.set(segment.person.id, segment.person);
  }
  return [...found.values()];
}

export type MentionSegment = { text: string; person: MentionPerson | null };

// Splits text for rendering: each mention is its own segment with the person it names.
export function splitOnMentions(text: string, people: MentionPerson[]): MentionSegment[] {
  const lower = text.toLowerCase();
  const segments: MentionSegment[] = [];
  let plain = "";
  for (let i = 0; i < text.length; ) {
    const person = opensMention(text, i) ? mentionAt(text, lower, i, people) : null;
    if (person) {
      if (plain) segments.push({ text: plain, person: null });
      plain = "";
      const length = 1 + person.name.trim().length;
      segments.push({ text: text.slice(i, i + length), person });
      i += length;
      continue;
    }
    plain += text[i]!;
    i++;
  }
  if (plain) segments.push({ text: plain, person: null });
  return segments;
}

// The "@query" being typed just before the caret, for the composer's autocomplete; null when the
// caret isn't in one. Names may contain spaces, so the query runs from the "@" to the caret.
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const at = text.lastIndexOf("@", caret - 1);
  if (at < 0 || !opensMention(text, at)) return null;
  const query = text.slice(at + 1, caret);
  if (query.length > 40 || /[\n@]/.test(query) || /\s{2}/.test(query)) return null;
  return { start: at, query };
}
