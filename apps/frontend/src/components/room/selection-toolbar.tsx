"use client";

import { ChatCircleTextIcon, CopyIcon, SparkleIcon, TextUnderlineIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import type { TextSelection } from "./anchors";
import { useRoom } from "./store";
import { INK_COLORS } from "./types";

type Props = {
  selection: TextSelection;
  // Position of the selection's top centre, relative to the document.
  at: { x: number; y: number };
  onHighlight: (color: string) => void;
  onUnderline: () => void;
  onComment: () => void;
  onAsk: () => void;
};

// Floats above selected text: copy, highlight (in any ink), underline, comment and ask the AI.
export function SelectionToolbar({ selection, at, onHighlight, onUnderline, onComment, onAsk }: Props) {
  const { perms } = useRoom();
  const item =
    "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[0.75rem] font-medium text-pearl/85 hover:bg-white/10 hover:text-pearl active:scale-95 transition";

  // Centred on the selection, the bar can run past the edge of the reading pane (under the Sources
  // rail or the side panel). Once it's on screen, shift it sideways just enough to fit inside.
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [nudge, setNudge] = useState(0);
  useLayoutEffect(() => {
    const pane = bar?.closest(".room-scroll");
    const article = bar?.offsetParent;
    if (!bar || !pane || !article) return;
    // From layout sizes, not the on-screen box: the entrance animation scales the bar, and measuring
    // that would change the answer on every frame.
    const half = bar.offsetWidth / 2;
    const centre = article.getBoundingClientRect().left + at.x;
    const p = pane.getBoundingClientRect();
    const margin = 12;
    const shift = Math.round(
      centre - half < p.left + margin
        ? p.left + margin - (centre - half)
        : centre + half > p.right - margin
          ? p.right - margin - (centre + half)
          : 0,
    );
    // Measuring the bar has to happen after layout, so this is where its position is corrected.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNudge(shift);
  }, [bar, at.x, at.y]);

  return (
    <motion.div
      data-room-ui
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", bounce: 0.25, duration: 0.35 }}
      onPointerDown={(e) => e.preventDefault()} // keep the selection
      ref={setBar}
      className="absolute z-40 flex w-max -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-full bg-ink/92 p-1 shadow-[0_16px_40px_-12px_rgb(5_7_13/0.6),inset_0_1px_0_rgb(255_255_255/0.12)] ring-1 ring-white/10 backdrop-blur-xl"
      style={{ left: at.x + nudge, top: at.y - 10 }}
      role="toolbar"
      aria-label="Selection"
    >
      <button
        type="button"
        className={item}
        onClick={() => {
          void navigator.clipboard.writeText(selection.quote).then(() => toast.success("Copied"));
        }}
      >
        <CopyIcon className="size-4" /> Copy
      </button>
      {perms.annotate && (
        <>
          <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden />
          <div className="flex items-center gap-1 px-1" aria-label="Highlight">
            {INK_COLORS.slice(0, 5).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Highlight ${c}`}
                onClick={() => onHighlight(c)}
                className="size-[18px] rounded-full ring-1 ring-white/30 transition-transform hover:scale-125"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button type="button" className={item} onClick={onUnderline} aria-label="Underline">
            <TextUnderlineIcon className="size-4" />
          </button>
          <button type="button" className={item} onClick={onComment}>
            <ChatCircleTextIcon className="size-4" /> Comment
          </button>
        </>
      )}
      {perms.useAi && (
        <button
          type="button"
          onClick={onAsk}
          className="ml-0.5 flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#2f5bff,#8b5cf6)] px-3 whitespace-nowrap text-[0.75rem] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] active:scale-95"
        >
          <SparkleIcon weight="fill" className="size-3.5" /> Ask AI
        </button>
      )}
    </motion.div>
  );
}
