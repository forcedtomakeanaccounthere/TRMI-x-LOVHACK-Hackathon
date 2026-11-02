import {
  BooksIcon,
  BriefcaseIcon,
  ChalkboardTeacherIcon,
  ChatsCircleIcon,
  CoffeeIcon,
  CrosshairIcon,
  CrosshairSimpleIcon,
  CursorClickIcon,
  FilePdfIcon,
  GraduationCapIcon,
  HighlighterIcon,
  SparkleIcon,
  WaveformIcon,
} from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react";

// The /ssr build has no React context, so these icons also render in Server Components.

export type Feature = { icon: Icon; title: string; body: string; href: string };

export const FEATURES: Feature[] = [
  { icon: CursorClickIcon, title: "Live cursors", body: "Named, coloured cursors that glide as people read.", href: "#features" },
  { icon: HighlighterIcon, title: "Shared highlights", body: "Select a line and it glows on every screen.", href: "#features" },
  { icon: ChatsCircleIcon, title: "Comment threads", body: "Discuss any highlight in the margin, live.", href: "#inside" },
  { icon: CrosshairIcon, title: "Follow mode", body: "Follow someone's scroll, or bring everyone to you.", href: "#inside" },
  { icon: WaveformIcon, title: "Voice huddles", body: "Talk in the room, with live captions and AI notes.", href: "#talk" },
  { icon: CrosshairSimpleIcon, title: "Laser focus", body: "Bring everyone to your line and point at it.", href: "#talk" },
  { icon: SparkleIcon, title: "AI group recap", body: "Claude summarises what the group cared about.", href: "#inside" },
  { icon: FilePdfIcon, title: "PDF rooms", body: "Drop a paper or slides; it all works the same.", href: "#features" },
];

export type UseCase = { icon: Icon; title: string; kicker: string; body: string; sample: string };

export const USE_CASES: UseCase[] = [
  {
    icon: GraduationCapIcon,
    title: "Study groups",
    kicker: "The night before the exam",
    body: "Read the arXiv paper together, argue in the margins, and walk away with one shared recap.",
    sample: "Attention Is All You Need",
  },
  {
    icon: BriefcaseIcon,
    title: "Product teams",
    kicker: "Spec review without the meeting",
    body: "Drop the competitor's launch post in a room. Everyone highlights what matters to their team.",
    sample: "Launch week: what shipped",
  },
  {
    icon: CoffeeIcon,
    title: "Friends",
    kicker: "The group chat, upgraded",
    body: "Stop sending screenshots of paragraphs. Send one room and read the essay side by side.",
    sample: "How to Do Great Work",
  },
  {
    icon: ChalkboardTeacherIcon,
    title: "Classrooms",
    kicker: "Close reading, together",
    body: "Students annotate the same chapter live, and you can see where the room slowed down.",
    sample: "The Federalist No. 10",
  },
  {
    icon: BooksIcon,
    title: "Book clubs",
    kicker: "Chapter by chapter",
    body: "Bring everyone to the same page with one tap, then let the conversation unfold beside it.",
    sample: "Meditations, Book II",
  },
];

export const STEPS = [
  {
    n: "I",
    title: "Paste any link",
    body: "Wikipedia, a blog post, the docs, a news story, or drop a PDF. We pull out a clean, readable page in about a second.",
  },
  {
    n: "II",
    title: "Share the room",
    body: "One short link or a QR code. Friends type a name and they are in. No installs, no accounts for guests.",
  },
  {
    n: "III",
    title: "Read together",
    body: "Cursors, highlights, comments, reactions and follow mode, all live. When you're done, the AI recaps the room.",
  },
];

export const SOURCES = [
  "Wikipedia",
  "arXiv",
  "MDN Web Docs",
  "Paul Graham",
  "Substack",
  "The Atlantic",
  "Medium",
  "Stratechery",
  "Lecture notes.pdf",
  "Your own link",
];

export const PEOPLE = [
  { name: "Abhishek", color: "#3B82F6" },
  { name: "Arun", color: "#EC4899" },
  { name: "Arnav", color: "#14B8A6" },
  { name: "Leo", color: "#8B5CF6" },
];
