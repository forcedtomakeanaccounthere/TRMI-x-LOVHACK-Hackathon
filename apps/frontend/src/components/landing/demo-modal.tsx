"use client";

import { PlayIcon } from "@phosphor-icons/react";
import { useLenis } from "lenis/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RoomPreview } from "./room-preview";

const MOMENTS = [
  { t: "0:00", title: "Paste the link", body: "Wikipedia's article on the Internet becomes a clean, shared page." },
  { t: "0:08", title: "Everyone joins", body: "Three friends open the room. Their cursors appear in their colours." },
  { t: "0:16", title: "Highlight and discuss", body: "Abhishek highlights a line; Arun asks a question right beside it." },
  { t: "0:24", title: "Recap lands everywhere", body: "One click, and the AI's group recap appears on every screen at once." },
];

export function DemoModal({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const lenis = useLenis();

  useEffect(() => {
    if (open) lenis?.stop();
    else lenis?.start();
  }, [open, lenis]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setStep((s) => (s + 1) % MOMENTS.length), 3200);
    return () => clearInterval(id);
  }, [open]);

  const moment = MOMENTS[step]!;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setStep(0);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        data-lenis-prevent
        className={
          "liquid-glass liquid-glass-strong w-[min(64rem,calc(100%-2rem))] max-w-none gap-0 rounded-[2rem] p-0 ring-0 duration-500 ease-out-expo sm:max-w-none data-open:zoom-in-90 data-open:slide-in-from-bottom-6 data-closed:zoom-out-95 " +
          // Phones: cap the height and scroll the body inside, keeping the close button pinned above it.
          "max-md:flex max-md:max-h-[calc(100dvh-2rem)] max-md:flex-col max-md:overflow-hidden max-md:*:data-[slot=dialog-close]:top-3 max-md:*:data-[slot=dialog-close]:right-3 max-md:*:data-[slot=dialog-close]:z-10 max-md:*:data-[slot=dialog-close]:size-9 max-md:*:data-[slot=dialog-close]:rounded-full max-md:*:data-[slot=dialog-close]:bg-background/80 max-md:*:data-[slot=dialog-close]:backdrop-blur-xl"
        }
      >
        <div className="grid gap-0 max-md:min-h-0 max-md:overflow-y-auto max-md:overscroll-contain md:grid-cols-[1.25fr_1fr]">
          <div className="relative overflow-hidden rounded-t-[2rem] bg-[radial-gradient(120%_100%_at_0%_0%,var(--orb-1),transparent_60%),radial-gradient(90%_90%_at_100%_100%,var(--orb-2),transparent_60%)] p-4 pt-14 sm:p-6 sm:pt-14 md:rounded-l-[2rem] md:rounded-tr-none md:p-10">
            <RoomPreview />
          </div>
          <div className="flex flex-col justify-between p-6 sm:p-7 md:p-10">
            <div>
              <div className="eyebrow text-azure">The thirty-second moment</div>
              <DialogTitle className="mt-4 font-display text-[2.1rem] leading-[0.95] font-normal sm:text-[2.6rem]">
                See a room <span className="italic">come alive.</span>
              </DialogTitle>
              <DialogDescription className="mt-3 text-[0.875rem] leading-relaxed text-muted-foreground">
                This is the demo we show judges: one link, three people, one recap.
              </DialogDescription>
            </div>

            <div className="mt-8 md:mt-10">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="font-mono text-[0.75rem] text-muted-foreground">{moment.t}</div>
                  <div className="mt-1 font-display text-[1.6rem] leading-tight">{moment.title}</div>
                  <p className="mt-1 text-[0.875rem] leading-relaxed text-muted-foreground">{moment.body}</p>
                </motion.div>
              </AnimatePresence>
              <div className="mt-6 flex gap-1.5" role="tablist" aria-label="Demo moments">
                {MOMENTS.map((m, i) => (
                  <button
                    key={m.t}
                    type="button"
                    role="tab"
                    aria-selected={i === step}
                    aria-label={m.title}
                    onClick={() => setStep(i)}
                    className="relative h-1 flex-1 overflow-hidden rounded-full bg-foreground/10"
                  >
                    {i === step && (
                      <motion.span
                        className="absolute inset-0 origin-left bg-azure"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 3.2, ease: "linear" }}
                      />
                    )}
                    {i < step && <span className="absolute inset-0 bg-foreground/40" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DemoTrigger(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="group inline-flex items-center gap-3 text-[0.875rem] font-medium text-foreground/80 transition-colors hover:text-foreground"
    >
      <span className="liquid-glass grid size-11 place-items-center rounded-full transition-transform duration-500 ease-fluid group-hover:scale-110">
        <PlayIcon weight="fill" className="size-3.5 translate-x-px text-azure" />
      </span>
      Watch it in action
    </button>
  );
}
