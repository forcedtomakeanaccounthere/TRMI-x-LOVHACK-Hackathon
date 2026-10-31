"use client";

import {
  CursorIcon,
  EraserIcon,
  HighlighterIcon,
  NotePencilIcon,
  PenNibIcon,
  ScanIcon,
  TextUnderlineIcon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useRoom } from "./store";
import { INK_COLORS, type Tool } from "./types";

const TOOLS: {
  id: Tool;
  label: string;
  key: string;
  icon: typeof CursorIcon;
}[] = [
  { id: "select", label: "Select", key: "V", icon: CursorIcon },
  {
    id: "highlight",
    label: "Highlight — select text, or drag over images and scans",
    key: "H",
    icon: HighlighterIcon,
  },
  { id: "underline", label: "Underline", key: "U", icon: TextUnderlineIcon },
  { id: "pen", label: "Draw", key: "P", icon: PenNibIcon },
  { id: "eraser", label: "Erase your marks", key: "E", icon: EraserIcon },
  {
    id: "note",
    label: "Text comment — click anywhere",
    key: "N",
    icon: NotePencilIcon,
  },
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));

// The floating glass dock under the document: tools, ink colours and pen width.
export function ToolDock() {
  const { tool, setTool, color, setColor, width, setWidth, perms, lens, setLens } = useRoom();
  if (!perms.annotate && !perms.useAi) return null;
  const inks = tool === "highlight" || tool === "underline" || tool === "pen" || tool === "note";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
      className="liquid-glass liquid-glass-strong pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto overscroll-x-contain rounded-full p-1.5 [scrollbar-width:none] [&>*]:shrink-0"
      role="toolbar"
      aria-label="Annotation tools"
    >
      {perms.annotate &&
        TOOLS.map(({ id, label, key, icon: Icon }) => {
          const on = tool === id && !lens;
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={on}
                  onClick={() => {
                    setLens(false);
                    setTool(id);
                  }}
                  className={cn(
                    "relative grid size-9 place-items-center rounded-full transition-colors active:scale-95",
                    on ? "text-pearl" : "text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="dock-active"
                      className="absolute inset-0 rounded-full bg-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.2)] dark:bg-azure"
                      transition={{
                        type: "spring",
                        bounce: 0.2,
                        duration: 0.45,
                      }}
                    />
                  )}
                  <Icon weight={on ? "fill" : "regular"} className="relative size-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {label} <kbd className="ml-1 opacity-60">{key}</kbd>
              </TooltipContent>
            </Tooltip>
          );
        })}

      {perms.annotate && inks && (
        <>
          <span className="mx-1 h-6 w-px bg-(--hairline)" aria-hidden />
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
            {INK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  "size-5 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                  color === c && "ring-2 ring-foreground/70",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </>
      )}

      {perms.annotate && tool === "pen" && !lens && (
        <div className="ml-1 flex items-center gap-0.5" role="radiogroup" aria-label="Pen width">
          {[2, 4, 7].map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={width === w}
              aria-label={`Width ${w}`}
              onClick={() => setWidth(w)}
              className={cn(
                "grid size-7 place-items-center rounded-full",
                width === w ? "bg-foreground/10" : "hover:bg-foreground/5",
              )}
            >
              <span className="rounded-full bg-foreground" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </div>
      )}

      {perms.useAi && (
        <>
          <span className="mx-1 h-6 w-px bg-(--hairline)" aria-hidden />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={lens}
                onClick={() => setLens(!lens)}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-medium transition-all active:scale-95",
                  lens
                    ? "bg-[linear-gradient(120deg,#2f5bff,#8b5cf6)] text-white shadow-[0_8px_24px_-8px_rgb(47_91_255/0.7)]"
                    : "text-foreground hover:bg-foreground/6",
                )}
              >
                <ScanIcon weight={lens ? "fill" : "regular"} className="size-[18px]" />
                AI lens
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Drag over any part of the page to ask about it <kbd className="ml-1 opacity-60">L</kbd>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </motion.div>
  );
}
