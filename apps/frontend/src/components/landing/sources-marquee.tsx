import { SOURCES } from "./content";

// Infinite ribbon of the kinds of pages people read in LinkRoom.
export function SourcesMarquee() {
  const row = [...SOURCES, ...SOURCES];
  return (
    <section aria-label="Works with" className="relative border-y border-(--hairline) py-7">
      <div className="mx-auto mb-5 max-w-7xl px-5 md:px-8">
        <span className="eyebrow text-muted-foreground">Works with almost anything you read</span>
      </div>
      <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <ul className="animate-marquee flex w-max items-center gap-14 pr-14">
          {row.map((s, i) => (
            <li
              key={i}
              aria-hidden={i >= SOURCES.length}
              className="flex items-center gap-14 font-display text-[2rem] whitespace-nowrap text-foreground/55 italic md:text-[2.5rem]"
            >
              {s}
              <span className="text-[0.75rem] text-azure not-italic">✦</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
