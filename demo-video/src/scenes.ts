// The storyboard. Times are seconds from the start of the scene's voiceover; points are
// normalised (0..1) positions in the screenshot. Each shot's camera moves between keyframes
// {t, x, y, z} where (x, y) is the point at the centre of the browser window and z the zoom.

export type Key = { t: number; x: number; y: number; z: number };
export type Callout = { t: number; x: number; y: number; label: string; color?: string; side?: "left" | "right" | "top" | "bottom"; until?: number };
export type Spot = { t: number; until?: number; x0: number; y0: number; x1: number; y1: number };
export type Shot = {
  src: string;
  at: number; // when this shot takes over (VO seconds); the first shot starts at 0
  cam: Key[];
  callouts?: Callout[];
  spots?: Spot[];
  cut?: "fade" | "state"; // state = same framing, a UI state change (short crossfade)
  sfx?: string;
};
export type Scene = {
  id: string;
  chapter?: string; // eyebrow, e.g. "02 · Dashboard"
  title?: [string, string]; // [plain, italic accent]
  kind?: "hook" | "outro" | "feature";
  shots: Shot[];
  tail?: number; // seconds after the voiceover ends
  chips?: { t: number; label: string; color: string }[]; // stacked list on the left (Studio)
  cursor?: { from: number; to: number; name: string; color: string; path: [number, number][] };
};

const k = (t: number, x: number, y: number, z: number): Key => ({ t, x, y, z });

export const SCENES: Scene[] = [
  {
    id: "s01_hook",
    kind: "hook",
    tail: 0.6,
    shots: [
      { src: "landing-problem.jpg", at: 1.95, cam: [k(0, 0.5, 0.56, 1.0), k(5, 0.47, 0.6, 1.14)] },
      { src: "landing-hero.jpg", at: 6.9, cam: [k(0, 0.3, 0.42, 1.35), k(2.8, 0.5, 0.5, 1.0)] },
    ],
  },
  {
    id: "s02_dashboard",
    chapter: "01 · Dashboard",
    title: ["Your reading", "HQ"],
    shots: [
      {
        src: "dashboard.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(2.9, 0.5, 0.5, 1.04), k(4.1, 0.31, 0.38, 1.85), k(6, 0.33, 0.4, 1.9)],
        callouts: [{ t: 4.3, x: 0.255, y: 0.495, label: "4 rooms running · 9 reading now", side: "bottom" }],
      },
      {
        src: "dashboard-people-groups.jpg",
        at: 6.0,
        cam: [k(0, 0.45, 0.62, 1.45), k(2.2, 0.47, 0.7, 1.55)],
        callouts: [{ t: 0.4, x: 0.24, y: 0.63, label: "Study groups", color: "#8b5cf6", side: "right" }],
      },
      {
        src: "dashboard-calendar.jpg",
        at: 8.15,
        cam: [k(0, 0.44, 0.68, 1.55), k(3, 0.46, 0.72, 1.65)],
        callouts: [{ t: 0.3, x: 0.24, y: 0.71, label: "Shared calendar", color: "#f97316", side: "right" }],
      },
    ],
  },
  {
    id: "s03_sources",
    chapter: "02 · Sources",
    title: ["Many documents,", "one room"],
    shots: [
      {
        src: "cap-add-upload.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.8, 0.5, 0.56, 1.6), k(5.6, 0.5, 0.57, 1.66)],
        callouts: [{ t: 2.6, x: 0.5, y: 0.585, label: "PDF · Word · PowerPoint · Markdown", side: "bottom" }],
      },
      {
        src: "cap-add-link.jpg",
        at: 5.55,
        cam: [k(0, 0.5, 0.42, 1.65), k(2, 0.52, 0.43, 1.7)],
        callouts: [{ t: 0.3, x: 0.62, y: 0.525, label: "Any web link", color: "#14b8a6", side: "bottom" }],
      },
      {
        src: "cap-add-upload.jpg",
        at: 7.55,
        cam: [k(0, 0.5, 0.68, 1.8), k(2.2, 0.5, 0.7, 1.85)],
        callouts: [{ t: 0.3, x: 0.42, y: 0.735, label: "Google Drive", color: "#f97316", side: "top" }],
      },
      {
        src: "room-ai-chat.jpg",
        at: 9.7,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.3, 0.13, 0.62, 1.95), k(5, 0.13, 0.66, 2.0)],
        callouts: [{ t: 2.3, x: 0.172, y: 0.57, label: "Choose what the AI reads", side: "right" }],
        spots: [{ t: 1.6, x0: 0.0, y0: 0.3, x1: 0.19, y1: 0.99 }],
      },
    ],
  },
  {
    id: "s04_youtube",
    chapter: "03 · YouTube",
    title: ["Videos become", "documents"],
    shots: [
      {
        src: "cap-add-youtube.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.3, 0.47, 0.55, 1.75), k(4, 0.48, 0.56, 1.8)],
        callouts: [{ t: 1.6, x: 0.32, y: 0.59, label: "Paste a YouTube link", color: "#e2557a", side: "bottom" }],
        sfx: "keyboard",
      },
      {
        src: "cap-youtube-doc.jpg",
        at: 4.0,
        cam: [k(0, 0.5, 0.45, 1.05), k(1.2, 0.36, 0.33, 1.6), k(6.5, 0.36, 0.62, 1.6)],
        callouts: [
          { t: 1.2, x: 0.26, y: 0.11, label: "Captions → a readable page", color: "#e2557a", side: "right", until: 3.4 },
          { t: 3.6, x: 0.255, y: 0.452, label: "Timestamped", side: "bottom" },
        ],
      },
    ],
  },
  {
    id: "s05_annotate",
    chapter: "04 · Annotate",
    title: ["Mark what", "matters"],
    shots: [
      { src: "cap-room.jpg", at: 0, cam: [k(0, 0.5, 0.5, 1.0), k(2.4, 0.36, 0.48, 1.55)] },
      {
        src: "cap-highlight.jpg",
        at: 2.75,
        cut: "state",
        sfx: "marker",
        cam: [k(0, 0.36, 0.48, 1.55), k(1, 0.365, 0.48, 1.56)],
        callouts: [{ t: 0.1, x: 0.2, y: 0.37, label: "Highlight", color: "#eab308", side: "top" }],
      },
      {
        src: "cap-underline.jpg",
        at: 3.6,
        cut: "state",
        sfx: "marker",
        cam: [k(0, 0.365, 0.48, 1.56), k(1.6, 0.37, 0.5, 1.58)],
        callouts: [{ t: 0.1, x: 0.3, y: 0.585, label: "Underline", color: "#2f5bff", side: "bottom" }],
      },
      {
        src: "cap-textbox.jpg",
        at: 5.2,
        cut: "state",
        sfx: "click",
        cam: [k(0, 0.37, 0.5, 1.58), k(0.8, 0.5, 0.52, 1.75), k(2.2, 0.52, 0.53, 1.78)],
        callouts: [{ t: 0.9, x: 0.66, y: 0.6, label: "Text box anywhere", color: "#f97316", side: "bottom" }],
      },
      {
        src: "cap-annotated.jpg",
        at: 7.4,
        cut: "state",
        cam: [k(0, 0.52, 0.53, 1.78), k(1.6, 0.4, 0.62, 1.3), k(4.2, 0.4, 0.62, 1.32)],
        callouts: [{ t: 1.8, x: 0.33, y: 0.95, label: "Highlight · underline · draw · erase · text", side: "top" }],
      },
    ],
  },
  {
    id: "s06_presence",
    chapter: "05 · Presence",
    title: ["See who's", "where"],
    cursor: {
      from: 0.6,
      to: 4.6,
      name: "Ben",
      color: "#2f5bff",
      path: [
        [0.5, 0.36],
        [0.42, 0.43],
        [0.38, 0.5],
        [0.27, 0.62],
        [0.36, 0.69],
      ],
    },
    shots: [
      {
        src: "live-cursors.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.4, 0.36, 0.55, 1.65), k(4.6, 0.37, 0.6, 1.7)],
      },
      {
        src: "ai-lens.jpg",
        at: 4.6,
        cam: [k(0, 0.85, 0.4, 1.75), k(3.2, 0.85, 0.6, 1.75)],
        callouts: [{ t: 0.4, x: 0.73, y: 0.33, label: "Live activity feed", side: "left" }],
      },
      {
        src: "features.jpg",
        at: 7.7,
        cam: [k(0, 0.33, 0.7, 1.55), k(3.6, 0.33, 0.73, 1.75)],
        callouts: [{ t: 0.4, x: 0.165, y: 0.69, label: "Follow mode", color: "#e2557a", side: "top" }],
      },
    ],
  },
  {
    id: "s07_laser",
    chapter: "06 · Laser Focus",
    title: ["Everyone,", "look here"],
    shots: [
      {
        src: "laser-focus.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.4, 0.3, 0.38, 1.6), k(3.7, 0.3, 0.42, 1.65)],
        spots: [{ t: 1.6, x0: 0.215, y0: 0.53, x1: 0.47, y1: 0.63 }],
        callouts: [{ t: 2.0, x: 0.43, y: 0.1, label: "One click pulls the room here", color: "#f97316", side: "bottom" }],
      },
      {
        src: "follow-mode-studio.jpg",
        at: 3.7,
        cam: [k(0, 0.5, 0.3, 1.5), k(2.5, 0.5, 0.2, 1.9)],
        callouts: [{ t: 0.6, x: 0.705, y: 0.035, label: "Stop focus anytime", color: "#e2557a", side: "bottom" }],
      },
    ],
  },
  {
    id: "s08_huddle",
    chapter: "07 · Huddle",
    title: ["Talk it", "through"],
    shots: [
      {
        src: "huddle-call.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.6, 0.11, 0.8, 2.3), k(5.6, 0.11, 0.82, 2.35)],
        callouts: [
          { t: 2.0, x: 0.06, y: 0.665, label: "Voice huddle", color: "#14b8a6", side: "right", until: 4 },
          { t: 3.9, x: 0.09, y: 0.9, label: "Live captions", side: "right" },
        ],
      },
      {
        src: "huddle-transcript.jpg",
        at: 5.6,
        cam: [k(0, 0.38, 0.38, 1.5), k(2.6, 0.38, 0.42, 1.6)],
        callouts: [{ t: 0.4, x: 0.36, y: 0.31, label: "Full transcript", side: "right" }],
      },
      {
        src: "huddle-notes.jpg",
        at: 8.0,
        cam: [k(0, 0.45, 0.42, 1.25), k(5.5, 0.45, 0.66, 1.55)],
        callouts: [
          { t: 0.9, x: 0.31, y: 0.205, label: "AI notes", color: "#8b5cf6", side: "left", until: 3 },
          { t: 2.6, x: 0.31, y: 0.62, label: "Action items, assigned", color: "#f97316", side: "left" },
          { t: 3.9, x: 0.33, y: 0.83, label: "Anchored to the passage", side: "right" },
        ],
      },
    ],
  },
  {
    id: "s09_lens",
    chapter: "08 · AI Lens",
    title: ["Ask about", "any region"],
    shots: [
      {
        src: "ai-lens.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.4, 0.38, 0.68, 1.75), k(7.6, 0.4, 0.7, 1.8)],
        spots: [{ t: 1.5, x0: 0.225, y0: 0.47, x1: 0.68, y1: 0.97 }],
        callouts: [
          { t: 1.9, x: 0.3, y: 0.51, label: "Drag over a diagram", color: "#8b5cf6", side: "top" },
          { t: 4.4, x: 0.6, y: 0.82, label: "Ask about exactly that", side: "right" },
        ],
      },
    ],
  },
  {
    id: "s10_chat",
    chapter: "09 · AI Chat",
    title: ["Answers with", "citations"],
    shots: [
      {
        src: "room-ai-chat.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.2, 0.84, 0.42, 1.75), k(5.6, 0.84, 0.5, 1.8)],
        callouts: [{ t: 2.8, x: 0.755, y: 0.71, label: "Citations jump to the passage", side: "left" }],
      },
    ],
  },
  {
    id: "s11_studio",
    chapter: "10 · Studio",
    title: ["Study material,", "one click"],
    chips: [
      { t: 3.64, label: "Summary", color: "#2f5bff" },
      { t: 4.68, label: "Quiz", color: "#f97316" },
      { t: 6.55, label: "Flashcards", color: "#14b8a6" },
      { t: 9.0, label: "Mind map", color: "#8b5cf6" },
      { t: 11.43, label: "Infographic", color: "#ec4899" },
    ],
    shots: [
      {
        src: "cap-studio.jpg",
        at: 0,
        cam: [k(0, 0.5, 0.5, 1.0), k(1.3, 0.85, 0.3, 1.9), k(3.6, 0.86, 0.32, 1.95)],
        sfx: "sparkle",
      },
      { src: "cap-summary.jpg", at: 3.64, cam: [k(0, 0.5, 0.34, 1.6), k(1.0, 0.5, 0.38, 1.62)] },
      { src: "cap-quiz.jpg", at: 4.68, cam: [k(0, 0.5, 0.26, 1.7), k(1.9, 0.5, 0.31, 1.74)] },
      { src: "cap-flashcard-front.jpg", at: 6.55, cam: [k(0, 0.5, 0.48, 1.7), k(1.1, 0.5, 0.49, 1.72)] },
      { src: "cap-flashcard.jpg", at: 7.65, cut: "state", sfx: "flip", cam: [k(0, 0.5, 0.49, 1.72), k(1.4, 0.5, 0.5, 1.75)] },
      { src: "cap-mindmap.jpg", at: 9.0, cam: [k(0, 0.38, 0.62, 1.55), k(2.4, 0.56, 0.6, 1.6)] },
      { src: "cap-infographic.jpg", at: 11.43, cam: [k(0, 0.5, 0.36, 1.45), k(2.6, 0.5, 0.52, 1.5)] },
    ],
  },
  {
    id: "s12_rooms",
    chapter: "11 · Rooms",
    title: ["Rooms that", "adapt"],
    shots: [
      { src: "new-room.jpg", at: 0, cam: [k(0, 0.48, 0.45, 1.45), k(1.7, 0.48, 0.48, 1.5)] },
      {
        src: "new-group.jpg",
        at: 1.7,
        cam: [k(0, 0.5, 0.5, 1.6), k(2, 0.5, 0.52, 1.66)],
      },
      {
        src: "room-settings.jpg",
        at: 3.7,
        cam: [k(0, 0.47, 0.5, 1.5), k(1.9, 0.5, 0.56, 1.6)],
        callouts: [{ t: 0.3, x: 0.645, y: 0.565, label: "Viewer or editor", side: "left" }],
      },
      { src: "discussion.jpg", at: 5.6, cam: [k(0, 0.84, 0.45, 1.65), k(1.6, 0.84, 0.55, 1.7)] },
      { src: "notebook.jpg", at: 7.2, cam: [k(0, 0.86, 0.35, 1.7), k(1.7, 0.86, 0.5, 1.72)] },
      { src: "while-you-were-away.jpg", at: 8.9, cam: [k(0, 0.49, 0.3, 1.55), k(3, 0.49, 0.52, 1.6)] },
    ],
  },
  {
    id: "s13_outro",
    kind: "outro",
    tail: 3.6,
    shots: [{ src: "landing-cta.jpg", at: 0, cam: [k(0, 0.5, 0.2, 1.25), k(2.8, 0.5, 0.24, 1.35)] }],
  },
];
