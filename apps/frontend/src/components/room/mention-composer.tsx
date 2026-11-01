"use client";

import { type MentionPerson, mentionQuery, splitOnMentions } from "@linkroom/shared";
import { AtIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "./bits";

// @mentions in the room's text boxes (Discussion and comment boxes). Typing "@" offers the people
// who can be mentioned (useRoom().mentionables); picking one writes "@Name ". What counts as a
// mention is decided by @linkroom/shared, so the browser and the backend agree.

type Field = HTMLInputElement | HTMLTextAreaElement;

const COLORS = ["#2f5bff", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#0ea5e9"];
const colorOf = (id: string) => COLORS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length]!;

export function useMentionPicker(value: string, setValue: (v: string) => void, people: MentionPerson[]) {
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [field, setField] = useState<Field | null>(null);

  const needle = query?.query.trim().toLowerCase() ?? "";
  const matches = query
    ? people
        .filter((p) => p.name.toLowerCase().includes(needle))
        .sort(
          (a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)),
        )
        .slice(0, 6)
    : [];
  const open = query !== null && matches.length > 0;

  const track = (el: Field) => {
    setField(el);
    setQuery(mentionQuery(el.value, el.selectionStart ?? el.value.length));
    setIndex(0);
  };

  const pick = (person: MentionPerson) => {
    if (!query || !field) return;
    const caret = field.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${person.name} ${value.slice(caret)}`;
    setValue(next);
    setQuery(null);
    const at = query.start + person.name.length + 2;
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(at, at);
    });
  };

  return {
    open,
    // Spread onto the input or textarea.
    bind: {
      onChange: (e: React.ChangeEvent<Field>) => {
        setValue(e.target.value);
        track(e.target);
      },
      onSelect: (e: React.SyntheticEvent<Field>) => track(e.currentTarget),
      onBlur: () => setTimeout(() => setQuery(null), 120), // after a click on a suggestion lands
    },
    // Call first in onKeyDown; true means the key was used by the picker.
    handleKey: (e: React.KeyboardEvent<Field>) => {
      if (!open) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[index]!);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return true;
      }
      return false;
    },
    menu: (
      <MentionMenu
        open={open}
        matches={matches}
        index={index}
        onHover={setIndex}
        onPick={pick}
        empty={query !== null && people.length === 0}
      />
    ),
  };
}

function MentionMenu({
  open,
  matches,
  index,
  onHover,
  onPick,
  empty,
}: {
  open: boolean;
  matches: MentionPerson[];
  index: number;
  onHover: (i: number) => void;
  onPick: (p: MentionPerson) => void;
  empty: boolean;
}) {
  return (
    <AnimatePresence>
      {(open || empty) && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
          className="liquid-glass liquid-glass-strong absolute inset-x-0 bottom-full z-50 mb-2 rounded-2xl p-1.5"
          role="listbox"
          aria-label="Mention someone"
        >
          <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5 text-[0.625rem] text-muted-foreground">
            <AtIcon className="size-3" /> People who joined this room or you follow
          </div>
          {empty ? (
            <p className="px-2.5 pb-2 text-[0.75rem] text-muted-foreground">
              No one to mention yet. People who open the room, or whom you follow, show up here.
            </p>
          ) : (
            matches.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(p)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors",
                  i === index ? "bg-azure/10 text-foreground" : "hover:bg-foreground/5",
                )}
              >
                <Avatar actor={{ name: p.name, color: colorOf(p.id) }} size={24} />
                <span className="flex-1 truncate">{p.name}</span>
                {i === index && <kbd className="text-[0.625rem] text-muted-foreground">Enter</kbd>}
              </button>
            ))
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Message or comment text with each @mention as a chip; mentions of you stand out more.
export function MentionText({ text, people, meId }: { text: string; people: MentionPerson[]; meId: string }) {
  return (
    <>
      {splitOnMentions(text, people).map((seg, i) =>
        seg.person ? (
          <span
            key={i}
            className={cn(
              "rounded-md px-1 font-medium",
              seg.person.id === meId ? "bg-amber-400/25 text-amber-900 dark:text-amber-200" : "bg-azure/12 text-azure",
            )}
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
