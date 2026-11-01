import { describe, expect, it } from "vitest";
import { MentionNotifyRequest, mentionQuery, parseMentions, RoomNotification, splitOnMentions } from "../src";

const ana = { id: "u-ana", name: "Ana" };
const ada = { id: "u-ada", name: "Ada" };
const adaL = { id: "u-adal", name: "Ada Lovelace" };
const ben = { id: "guest-ben", name: "Ben" };
const people = [ana, ada, adaL, ben];

describe("parseMentions: who a message tags", () => {
  it("a reader tags a roommate by name, case-insensitively", () => {
    expect(parseMentions("hey @ana look at this", people)).toEqual([ana]);
    expect(parseMentions("@ANA!", people)).toEqual([ana]);
  });

  it("several people, each once, in order of first mention", () => {
    expect(parseMentions("@Ben and @Ana, then @ben again", people)).toEqual([ben, ana]);
  });

  it("the longest matching name wins", () => {
    expect(parseMentions("ask @Ada Lovelace about it", people)).toEqual([adaL]);
    expect(parseMentions("ask @Ada about it", people)).toEqual([ada]);
  });

  it("a name only matches whole: @Anabel is not Ana", () => {
    expect(parseMentions("@Anabel hi", people)).toEqual([]);
  });

  it("unknown names and email addresses are not mentions", () => {
    expect(parseMentions("@nobody mail ana@example.com", people)).toEqual([]);
  });

  it("mentions inside brackets and quotes count", () => {
    expect(parseMentions('(cc @Ana) "@Ben"', people)).toEqual([ana, ben]);
  });

  it("no people, no mentions", () => {
    expect(parseMentions("@Ana", [])).toEqual([]);
  });
});

describe("splitOnMentions: rendering a message", () => {
  it("keeps the text exactly as typed and marks each mention", () => {
    expect(splitOnMentions("hi @ana, see p.3", people)).toEqual([
      { text: "hi ", person: null },
      { text: "@ana", person: ana },
      { text: ", see p.3", person: null },
    ]);
  });

  it("plain text is one segment", () => {
    expect(splitOnMentions("nothing here", people)).toEqual([{ text: "nothing here", person: null }]);
  });
});

describe("mentionQuery: the composer's autocomplete", () => {
  it("finds the @query before the caret", () => {
    expect(mentionQuery("hey @An", 7)).toEqual({ start: 4, query: "An" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("allows a space for two-word names", () => {
    expect(mentionQuery("ask @Ada Lo", 11)).toEqual({ start: 4, query: "Ada Lo" });
  });

  it("is null outside a mention", () => {
    expect(mentionQuery("hello", 5)).toBeNull();
    expect(mentionQuery("ana@ex", 6)).toBeNull();
    expect(mentionQuery("@Ana\nnext", 9)).toBeNull();
  });
});

describe("mention schemas", () => {
  it("accepts an announcement and caps its size", () => {
    const ok = { event_id: "e1", kind: "chat", body: "@Ana hi", author: ben, mentions: [ana] };
    expect(MentionNotifyRequest.safeParse(ok).success).toBe(true);
    expect(MentionNotifyRequest.safeParse({ ...ok, body: "" }).success).toBe(false);
    expect(MentionNotifyRequest.safeParse({ ...ok, mentions: Array(21).fill(ana) }).success).toBe(false);
    expect(MentionNotifyRequest.safeParse({ ...ok, kind: "email" }).success).toBe(false);
  });

  it("a room toast names who it is for", () => {
    const toast = { user_id: "u-ana", room_id: "x7Kp2qLm", title: "Room", body: "hi", actor_name: "Ben" };
    expect(RoomNotification.parse(toast)).toEqual(toast);
    expect(RoomNotification.safeParse({ ...toast, user_id: undefined }).success).toBe(false);
  });
});
