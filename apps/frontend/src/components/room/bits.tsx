"use client";

import { initials, timeAgo } from "@/components/dashboard/primitives";
import { cn } from "@/lib/utils";
import type { Actor } from "./types";

export { timeAgo };

export function Avatar({
  actor,
  size = 28,
  ring,
  className,
}: {
  actor: Pick<Actor, "name" | "color">;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white select-none",
        ring && "ring-2 ring-background",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: actor.color,
        fontSize: Math.max(9, size * 0.38),
      }}
      title={actor.name}
      aria-hidden
    >
      {initials(actor.name)}
    </span>
  );
}

export function ByLine({ actor, at, className }: { actor: Actor; at: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground", className)}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: actor.color }} />
      <span className="truncate font-medium text-foreground/80">{actor.name}</span>
      <span aria-hidden>·</span>
      <time dateTime={at} className="shrink-0">
        {timeAgo(at)}
      </time>
    </span>
  );
}

export function PreviewTag({ className }: { className?: string }) {
  return (
    <span
      title="Built in the browser because the AI endpoint isn't connected yet"
      className={cn(
        "rounded-full bg-amber-500/12 px-1.5 py-px text-[0.5625rem] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300",
        className,
      )}
    >
      Preview
    </span>
  );
}

// Renders AI text: paragraphs, "- " bullets and `code`, nothing else (no HTML from the model).
export function AiText({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className={cn("space-y-2 text-[0.8125rem] leading-relaxed", className)}>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-4">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded bg-foreground/8 px-1 py-px font-mono text-[0.92em]">
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
      aria-hidden
    />
  );
}

// Three pulsing dots while the AI writes.
export function Thinking() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-azure"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}
